/**
 * Local TCP <-> proxyd `/__depot/tunnel` WebSocket bridge.
 *
 * createPreviewCode's model forwards an HTTP request carrying the public
 * preview hostname straight to the backend — broken for anything that
 * validates its own Host (Chrome CDP's WebSocket upgrade being the
 * motivating case). proxyd's tunnel terminates the WebSocket itself and
 * dials the backend directly, so nothing the backend ever sees carries a
 * foreign Host. This bridge makes that reachable as a plain local TCP
 * connection, which is what `chromium.connectOverCDP` (or any other raw-TCP
 * client) expects.
 *
 * Each local connection maps 1:1 to one tunnel WebSocket: once either side
 * closes, the other is torn down (matches proxyd's own tunnel.rs, which
 * treats a WS Close as a whole-connection event, no half-close).
 */
import net from "node:net";
import type { ZeishTunnelAccess } from "./zeish.types";

const TUNNEL_PATH = "/__depot/tunnel";
const PROTO_PREFIX = "depot-tunnel.v1.";

export interface TunnelBridgeOptions {
  /** Local bind host. Default 127.0.0.1 — never expose the bridge beyond loopback. */
  localHost?: string;
  /** Local port to bind. Default 0 (OS-assigned ephemeral port). */
  localPort?: number;
  /** Tunnel WebSocket open timeout in ms. Default 15000. */
  connectTimeoutMs?: number;
}

export interface TunnelBridge {
  /** Loopback host the bridge is bound to. */
  localHost: string;
  /** OS-assigned (or caller-specified) local port. */
  localPort: number;
  /** `http://{localHost}:{localPort}` — base URL for HTTP-shaped local connections. */
  httpUrl: string;
  /** Stop accepting new connections and close every connection in flight. */
  close(): Promise<void>;
}

/**
 * Starts a local TCP server that tunnels every accepted connection to
 * `port` on the sandbox behind `access`, one tunnel WebSocket per local
 * connection. Generic — works for CDP, a database, or any other
 * tunnel.rs-registered TCP port. See createCdpTunnelBridge for the
 * CDP-discovery-aware variant.
 */
export async function createTunnelBridge(
  access: ZeishTunnelAccess,
  port: number,
  options: TunnelBridgeOptions = {},
): Promise<TunnelBridge> {
  const localHost = options.localHost ?? "127.0.0.1";
  const connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
  const openTunnels = new Set<{ close(): void }>();

  const server = net.createServer((socket) => {
    const tunnel = pipeSocketToTunnel(socket, access, port, connectTimeoutMs);
    openTunnels.add(tunnel);
    const forget = () => openTunnels.delete(tunnel);
    socket.once("close", forget);
    socket.once("error", forget);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.localPort ?? 0, localHost, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("tunnel bridge: local TCP server has no bound port");
  }

  return {
    localHost,
    localPort: address.port,
    httpUrl: `http://${localHost}:${address.port}`,
    close: async () => {
      for (const tunnel of openTunnels) tunnel.close();
      openTunnels.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/**
 * Opens one tunnel WebSocket for `socket` and splices bytes both ways.
 * `alreadyRead`, if given, is bytes already consumed off `socket` (e.g. by a
 * caller peeking the request head to classify it) that must be forwarded
 * first, ahead of whatever `socket` emits from here on.
 */
function pipeSocketToTunnel(
  socket: net.Socket,
  access: ZeishTunnelAccess,
  port: number,
  connectTimeoutMs: number,
  alreadyRead?: Buffer,
): { close(): void } {
  const ws = openTunnelSocket(access, port, connectTimeoutMs);
  // Bytes the local client sends before the tunnel WS finishes connecting
  // must not be dropped.
  const pending: Buffer[] = alreadyRead && alreadyRead.length > 0 ? [alreadyRead] : [];
  let ready = false;

  socket.on("data", (chunk: Buffer) => {
    if (ready) ws.send(chunk);
    else pending.push(chunk);
  });
  ws.addEventListener("open", () => {
    ready = true;
    for (const chunk of pending) ws.send(chunk);
    pending.length = 0;
  });
  ws.addEventListener("message", (event) => {
    socket.write(toBuffer(event.data));
  });

  const closeBoth = () => {
    socket.destroy();
    try {
      ws.close();
    } catch {
      /* already closed */
    }
  };
  socket.once("close", closeBoth);
  socket.once("error", closeBoth);
  ws.addEventListener("close", () => socket.end());
  ws.addEventListener("error", () => socket.destroy());

  return { close: closeBoth };
}

/** Opens one `/__depot/tunnel` WebSocket, authorized for `port` on `access`'s sandbox. */
function openTunnelSocket(
  access: ZeishTunnelAccess,
  port: number,
  connectTimeoutMs: number,
): WebSocket {
  const url = new URL(access.wsUrl);
  if (!url.pathname.endsWith(TUNNEL_PATH)) {
    url.pathname = TUNNEL_PATH;
  }
  url.searchParams.set("token", access.token);

  const ws = new WebSocket(url, [`${PROTO_PREFIX}port.${port}`]);
  ws.binaryType = "arraybuffer";

  const timer = setTimeout(() => {
    if (ws.readyState === WebSocket.CONNECTING) ws.close();
  }, connectTimeoutMs);
  ws.addEventListener("open", () => clearTimeout(timer), { once: true });
  ws.addEventListener("close", () => clearTimeout(timer), { once: true });

  return ws;
}

function toBuffer(data: string | ArrayBuffer | Blob): Buffer {
  if (typeof data === "string") return Buffer.from(data, "utf8");
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  throw new TypeError(
    "tunnel bridge: expected ArrayBuffer message data — set ws.binaryType = 'arraybuffer'",
  );
}

// ---- CDP-aware bridge --------------------------------------------------

/** Caps how many bytes of a request head this bridge will buffer before
 * giving up on classifying it (WS upgrade vs. plain discovery GET). Chrome
 * DevTools request heads are a handful of short standard headers. */
const MAX_HEAD_BYTES = 64 * 1024;

export interface CdpTunnelBridge extends TunnelBridge {
  /** Same as httpUrl — Playwright's connectOverCDP accepts either scheme for its own /json/version fetch. */
  wsUrl: string;
}

/**
 * Like createTunnelBridge, but aware of Chrome's `/json`, `/json/list`, and
 * `/json/version` discovery endpoints: Chrome's own response echoes
 * whatever Host it saw as `ws://<host>/devtools/...`, which is meaningless
 * outside the sandbox. This rewrites every `ws://`/`wss://` occurrence in
 * such a response to point back at this bridge's own local address, so
 * `chromium.connectOverCDP`'s own discovery fetch (when given httpUrl
 * instead of a specific ws(s) endpoint) resolves to a reachable URL instead
 * of Chrome's internal one.
 *
 * The actual WebSocket upgrade (`/devtools/browser/<id>` etc.) is left
 * completely untouched — passed through as opaque bytes, same as
 * createTunnelBridge.
 */
export async function createCdpTunnelBridge(
  access: ZeishTunnelAccess,
  port: number,
  options: TunnelBridgeOptions = {},
): Promise<CdpTunnelBridge> {
  const localHost = options.localHost ?? "127.0.0.1";
  const connectTimeoutMs = options.connectTimeoutMs ?? 15_000;
  const openTunnels = new Set<{ close(): void }>();
  const server = net.createServer();

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.localPort ?? 0, localHost, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("tunnel bridge: local TCP server has no bound port");
  }
  const localAuthority = `${localHost}:${address.port}`;

  server.on("connection", (socket) => {
    const handle = classifyThenBridge(socket, access, port, connectTimeoutMs, localAuthority);
    openTunnels.add(handle);
    const forget = () => openTunnels.delete(handle);
    socket.once("close", forget);
    socket.once("error", forget);
  });

  return {
    localHost,
    localPort: address.port,
    httpUrl: `http://${localAuthority}`,
    wsUrl: `ws://${localAuthority}`,
    close: async () => {
      for (const tunnel of openTunnels) tunnel.close();
      openTunnels.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

const CRLFCRLF = Buffer.from("\r\n\r\n");

/** Buffers just enough of the request head to tell a WebSocket upgrade
 * apart from a plain GET, then either passes through raw or intercepts. */
function classifyThenBridge(
  socket: net.Socket,
  access: ZeishTunnelAccess,
  port: number,
  connectTimeoutMs: number,
  localAuthority: string,
): { close(): void } {
  let peeked = Buffer.alloc(0);
  let decided:
    | { mode: "passthrough"; tunnel: { close(): void } }
    | { mode: "rewrite" }
    | undefined;

  const onDataWhilePeeking = (chunk: Buffer) => {
    if (decided) return; // listener removed once decided; guards a same-tick race
    peeked = Buffer.concat([peeked, chunk]);
    const headEnd = peeked.indexOf(CRLFCRLF);
    if (headEnd === -1) {
      if (peeked.length > MAX_HEAD_BYTES) {
        socket.destroy(new Error("tunnel bridge: request head too large to classify"));
      }
      return;
    }

    socket.removeListener("data", onDataWhilePeeking);
    const head = peeked.subarray(0, headEnd).toString("latin1");
    const isWebSocketUpgrade = /^upgrade:\s*websocket\s*$/im.test(head);

    if (isWebSocketUpgrade) {
      const tunnel = pipeSocketToTunnel(socket, access, port, connectTimeoutMs, peeked);
      decided = { mode: "passthrough", tunnel };
    } else {
      decided = { mode: "rewrite" };
      void handleDiscoveryRequest(socket, peeked, access, port, connectTimeoutMs, localAuthority);
    }
  };
  socket.on("data", onDataWhilePeeking);

  return {
    close: () => {
      socket.removeListener("data", onDataWhilePeeking);
      if (decided?.mode === "passthrough") decided.tunnel.close();
      else socket.destroy();
    },
  };
}

/** Tunnels a plain (non-upgrade) request, buffers the full response, and
 * rewrites any ws(s):// URL in it to point back at this bridge. */
async function handleDiscoveryRequest(
  socket: net.Socket,
  requestHead: Buffer,
  access: ZeishTunnelAccess,
  port: number,
  connectTimeoutMs: number,
  localAuthority: string,
): Promise<void> {
  const forcedClose = forceConnectionClose(requestHead);
  const ws = openTunnelSocket(access, port, connectTimeoutMs);
  const chunks: Buffer[] = [];

  // Resolve on "close" alone, not "error": per the WebSocket spec close
  // always follows error, and a close that follows an abrupt (non-close-
  // frame) disconnect still fires as an error+close pair. If we already
  // have the full response by then, that's still a usable result — don't
  // discard it just because the connection didn't end cleanly.
  await new Promise<void>((resolve) => {
    ws.addEventListener("open", () => ws.send(forcedClose), { once: true });
    ws.addEventListener("message", (event) => chunks.push(toBuffer(event.data)));
    ws.addEventListener("close", () => resolve(), { once: true });
    socket.once("close", () => {
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    });
  });

  if (socket.destroyed) return;
  if (chunks.length === 0) {
    socket.destroy(new Error("tunnel bridge: discovery request failed (no response)"));
    return;
  }
  const raw = Buffer.concat(chunks);
  const headEnd = raw.indexOf(CRLFCRLF);
  if (headEnd === -1) {
    socket.end(raw); // not a well-formed HTTP response — relay verbatim
    return;
  }

  const head = raw.subarray(0, headEnd).toString("latin1");
  const body = raw.subarray(headEnd + CRLFCRLF.length);
  const rewrittenBody = rewriteWebSocketUrls(body, localAuthority);
  const rewrittenHead = replaceContentLength(head, rewrittenBody.length);
  socket.end(Buffer.concat([Buffer.from(rewrittenHead, "latin1"), CRLFCRLF, rewrittenBody]));
}

/** Appends (or replaces) a `Connection: close` header on a raw request head,
 * so the backend closes after one response instead of us guessing when a
 * discovery response — which may omit Content-Length — is complete. */
export function forceConnectionClose(requestHead: Buffer): Buffer {
  const text = requestHead.toString("latin1");
  const headEnd = text.indexOf("\r\n\r\n");
  const head = headEnd === -1 ? text : text.slice(0, headEnd);
  const rest = headEnd === -1 ? "" : text.slice(headEnd);
  const withoutConnection = head
    .split("\r\n")
    .filter((line) => !/^connection:/i.test(line))
    .join("\r\n");
  return Buffer.from(`${withoutConnection}\r\nConnection: close${rest}`, "latin1");
}

export function replaceContentLength(head: string, bodyLength: number): string {
  const lines = head.split("\r\n");
  let replaced = false;
  const next = lines.map((line) => {
    if (/^content-length:/i.test(line)) {
      replaced = true;
      return `Content-Length: ${bodyLength}`;
    }
    return line;
  });
  if (!replaced) next.push(`Content-Length: ${bodyLength}`);
  return next.join("\r\n");
}

/** Rewrites `ws://<host>[:<port>]` / `wss://<host>[:<port>]` to point at
 * this bridge, leaving the path/query of each URL untouched. */
export function rewriteWebSocketUrls(body: Buffer, localAuthority: string): Buffer {
  const text = body.toString("utf8");
  const rewritten = text.replace(
    /wss?:\/\/[^/"'\s]+/g,
    (match) => `ws://${localAuthority}`,
  );
  return Buffer.from(rewritten, "utf8");
}
