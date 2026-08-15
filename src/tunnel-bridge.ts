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

/**
 * A bridge is an unauthenticated raw tunnel once bound: any local process
 * (and, if bound beyond loopback, any network peer) that can reach it gets
 * to open a connection as the tunnel token's holder, no further credential
 * required. Reject anything but a loopback bind so that's always confined
 * to processes on the same machine.
 */
function assertLoopbackHost(host: string): void {
  if (host === "127.0.0.1" || host === "::1" || host === "localhost") return;
  throw new Error(
    `tunnel bridge: localHost must be a loopback address (127.0.0.1, ::1, or localhost), got ${JSON.stringify(host)} — ` +
      "binding beyond loopback would expose an unauthenticated raw tunnel to the network.",
  );
}

/** `host:port`, bracketing an IPv6 literal so it's valid inside a URL authority. */
function formatAuthority(host: string, port: number): string {
  return host.includes(":") ? `[${host}]:${port}` : `${host}:${port}`;
}

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
  assertLoopbackHost(localHost);
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
    httpUrl: `http://${formatAuthority(localHost, address.port)}`,
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
  let pendingBytes = pending.reduce((n, b) => n + b.length, 0);
  let ready = false;

  // Without this, a fast local sender (a bulk-transfer use case like a
  // database dump — this bridge is generic, not CDP-only) keeps queuing
  // ws.send() calls as fast as the socket delivers "data" events, with
  // nothing pausing the source when proxyd/the sandbox drains slower than
  // that. The queue grows unbounded and can exhaust the process's memory.
  // Before the tunnel WS opens there's nothing to send to yet, so the same
  // watermarks gate `pending` itself — a slow/stalled tunnel handshake must
  // pause the local socket exactly like a slow drain does once open.
  const backpressure = createBackpressureController({
    getBufferedAmount: () => (ready ? ws.bufferedAmount : pendingBytes),
    isOpen: () => ws.readyState === WebSocket.OPEN,
    pause: () => socket.pause(),
    resume: () => socket.resume(),
    isPaused: () => socket.isPaused(),
  });

  socket.on("data", (chunk: Buffer) => {
    if (ready) {
      ws.send(chunk);
    } else {
      pending.push(chunk);
      pendingBytes += chunk.length;
    }
    backpressure.check();
  });
  ws.addEventListener("open", () => {
    ready = true;
    for (const chunk of pending) ws.send(chunk);
    pending.length = 0;
    pendingBytes = 0;
    backpressure.check();
  });

  // socket.write() queues internally in userspace when the local reader is
  // slow, same unbounded-growth risk as the outbound direction above — but
  // the native WebSocket has no way to pause delivery of "message" events,
  // so this can only gate how fast queued bytes are handed to the socket,
  // not how fast they arrive. Still worth doing: without checking write()'s
  // return value, Node would silently accumulate every queued write in its
  // own internal buffer with no back-off at all.
  const downstreamQueue: Buffer[] = [];
  let downstreamDraining = false;
  const flushDownstream = () => {
    while (downstreamQueue.length > 0) {
      const chunk = downstreamQueue[0]!;
      const ok = socket.write(chunk);
      downstreamQueue.shift();
      if (!ok) {
        downstreamDraining = true;
        socket.once("drain", () => {
          downstreamDraining = false;
          flushDownstream();
        });
        return;
      }
    }
  };
  ws.addEventListener("message", (event) => {
    downstreamQueue.push(toBuffer(event.data));
    if (!downstreamDraining) flushDownstream();
  });

  const closeBoth = () => {
    backpressure.dispose();
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

/** Pause the local source once this much is queued on the tunnel WS. */
export const WS_SEND_HIGH_WATERMARK = 4 * 1024 * 1024;
/** Resume once queued data drains back below this. */
export const WS_SEND_LOW_WATERMARK = 1 * 1024 * 1024;
/** How often to poll bufferedAmount while paused — native WebSocket has no drain event. */
const DRAIN_POLL_MS = 20;

export interface BackpressureSource {
  getBufferedAmount(): number;
  isOpen(): boolean;
  pause(): void;
  resume(): void;
  isPaused(): boolean;
}

/**
 * Pauses `source` once `getBufferedAmount()` crosses the high watermark and
 * resumes it once buffered data drains back below the low watermark (or the
 * destination closes). Two watermarks, not one, so a value oscillating
 * right at a single threshold can't rapidly pause/resume the source.
 */
export function createBackpressureController(source: BackpressureSource): {
  check(): void;
  dispose(): void;
} {
  let drainTimer: ReturnType<typeof setInterval> | undefined;
  const check = () => {
    if (drainTimer || source.isPaused()) return;
    if (source.getBufferedAmount() <= WS_SEND_HIGH_WATERMARK) return;
    source.pause();
    drainTimer = setInterval(() => {
      if (source.getBufferedAmount() <= WS_SEND_LOW_WATERMARK || !source.isOpen()) {
        clearInterval(drainTimer);
        drainTimer = undefined;
        source.resume();
      }
    }, DRAIN_POLL_MS);
  };
  return {
    check,
    dispose: () => {
      if (drainTimer) clearInterval(drainTimer);
      drainTimer = undefined;
    },
  };
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

export type CdpTunnelBridge = TunnelBridge;

/**
 * Like createTunnelBridge, but aware of Chrome's `/json`, `/json/list`, and
 * `/json/version` discovery endpoints: Chrome's own response echoes
 * whatever Host it saw as `ws://<host>/devtools/...`, which is meaningless
 * outside the sandbox. This rewrites every `ws://`/`wss://` occurrence in
 * such a response to point back at this bridge's own local address, so
 * `chromium.connectOverCDP`'s own discovery fetch resolves to a reachable
 * URL instead of Chrome's internal one.
 *
 * Always connect with `httpUrl`, not a bare `ws://` URL built from it:
 * Playwright treats a literal ws(s) endpoint as already-resolved and skips
 * discovery entirely, but this bridge's own address has no
 * `/devtools/browser/<id>` path — only Chrome's `/json/version` response
 * (reached by discovery) has that. `CdpTunnelBridge` deliberately doesn't
 * expose a `wsUrl` field for this reason; there's no valid one to give.
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
  assertLoopbackHost(localHost);
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
  const localAuthority = formatAuthority(localHost, address.port);

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
