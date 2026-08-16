import { createHash } from "node:crypto";
import http from "node:http";
import net from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createBackpressureController,
  createCdpTunnelBridge,
  createTunnelBridge,
  forceConnectionClose,
  replaceContentLength,
  rewriteWebSocketUrls,
  WS_SEND_HIGH_WATERMARK,
  WS_SEND_LOW_WATERMARK,
} from "./tunnel-bridge";
import type { ZeishTunnelAccess } from "./zeish.types";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

function acceptKey(clientKey: string): string {
  return createHash("sha1").update(clientKey + WS_GUID).digest("base64");
}

/**
 * Minimal RFC6455 test server standing in for proxyd's `/__depot/tunnel`:
 * completes the WS handshake, then hands the caller a simple send/onMessage
 * API over unmasked (server->client) / masked (client->server) binary
 * frames — just enough to exercise the bridge's own client-side framing,
 * not a general-purpose WS server.
 */
function startMockTunnelServer(
  onConnection: (conn: {
    protocol: string | undefined;
    send(data: Buffer): void;
    onMessage(cb: (data: Buffer) => void): void;
    close(): void;
  }) => void,
  options: { handshakeDelayMs?: number } = {},
): Promise<{ url: string; close(): Promise<void> }> {
  const server = http.createServer();
  server.on("upgrade", (req, socket) => {
    // A test client that terminates the connection (e.g. the bridge closing
    // it once a watermark trips) can leave a write in flight on this side;
    // without this listener that surfaces as an unhandled EPIPE and fails
    // the whole test run rather than the one assertion that cares.
    socket.on("error", () => {});
    const key = req.headers["sec-websocket-key"];
    if (typeof key !== "string") {
      socket.destroy();
      return;
    }
    const protocol = req.headers["sec-websocket-protocol"]?.toString().split(",")[0]?.trim();
    const headers = [
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      ...(protocol ? [`Sec-WebSocket-Protocol: ${protocol}`] : []),
      "\r\n",
    ].join("\r\n");
    if (options.handshakeDelayMs) {
      setTimeout(() => socket.write(headers), options.handshakeDelayMs);
    } else {
      socket.write(headers);
    }

    const send = (data: Buffer) => {
      // Unmasked server->client binary frame; small-payload framing only
      // (sufficient for these tests' short fixtures).
      const len = data.length;
      let header: Buffer;
      if (len < 126) {
        header = Buffer.from([0x82, len]);
      } else {
        header = Buffer.alloc(4);
        header[0] = 0x82;
        header[1] = 126;
        header.writeUInt16BE(len, 2);
      }
      socket.write(Buffer.concat([header, data]));
    };

    let messageCb: ((data: Buffer) => void) | undefined;
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        if (buf.length < 2) return;
        const firstByte = buf[0] as number;
        const secondByte = buf[1] as number;
        const opcode = firstByte & 0x0f;
        const masked = (secondByte & 0x80) !== 0;
        let payloadLen = secondByte & 0x7f;
        let offset = 2;
        if (payloadLen === 126) {
          if (buf.length < 4) return;
          payloadLen = buf.readUInt16BE(2);
          offset = 4;
        }
        const maskLen = masked ? 4 : 0;
        if (buf.length < offset + maskLen + payloadLen) return;
        const mask = masked ? buf.subarray(offset, offset + 4) : undefined;
        const payloadStart = offset + maskLen;
        const payload = Buffer.from(buf.subarray(payloadStart, payloadStart + payloadLen));
        if (mask) {
          for (let i = 0; i < payload.length; i++) {
            payload[i] = (payload[i] as number) ^ (mask[i % 4] as number);
          }
        }
        buf = buf.subarray(payloadStart + payloadLen);
        if (opcode === 0x8) {
          // Close: echo an unmasked close frame back, then end the TCP
          // connection — a real WS close handshake, not just a raw FIN, so
          // the bridge's own client-side WebSocket sees a clean closure.
          socket.end(Buffer.from([0x88, 0x00]));
          return;
        }
        messageCb?.(payload);
      }
    });

    onConnection({
      protocol,
      send,
      onMessage: (cb) => {
        messageCb = cb;
      },
      close: () => socket.end(),
    });
  });

  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address === null || typeof address === "string") throw new Error("no port");
      resolve({
        url: `ws://127.0.0.1:${address.port}`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}

function access(wsUrl: string): ZeishTunnelAccess {
  return { wsUrl, token: "test-token", expiresAt: new Date(Date.now() + 60_000).toISOString() };
}

describe("rewriteWebSocketUrls", () => {
  it("rewrites ws:// and wss:// occurrences to the local authority, preserving path", () => {
    const body = Buffer.from(
      '{"webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/browser/abc-123"}',
    );
    const result = rewriteWebSocketUrls(body, "127.0.0.1:54321").toString();
    expect(result).toBe(
      '{"webSocketDebuggerUrl":"ws://127.0.0.1:54321/devtools/browser/abc-123"}',
    );
  });

  it("rewrites every occurrence in a /json list response", () => {
    const body = Buffer.from(
      '[{"webSocketDebuggerUrl":"ws://internal:9222/devtools/page/1"},' +
        '{"webSocketDebuggerUrl":"wss://internal:9222/devtools/page/2"}]',
    );
    const result = rewriteWebSocketUrls(body, "127.0.0.1:1").toString();
    expect(result).toContain("ws://127.0.0.1:1/devtools/page/1");
    expect(result).toContain("ws://127.0.0.1:1/devtools/page/2");
  });
});

describe("replaceContentLength", () => {
  it("replaces an existing Content-Length header", () => {
    const head = "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 5";
    expect(replaceContentLength(head, 42)).toBe(
      "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 42",
    );
  });

  it("appends Content-Length when missing", () => {
    const head = "HTTP/1.1 200 OK\r\nContent-Type: application/json";
    expect(replaceContentLength(head, 7)).toBe(
      "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 7",
    );
  });
});

describe("forceConnectionClose", () => {
  it("replaces an existing Connection header", () => {
    const raw = Buffer.from("GET / HTTP/1.1\r\nHost: x\r\nConnection: keep-alive\r\n\r\n");
    const result = forceConnectionClose(raw).toString();
    expect(result).not.toContain("keep-alive");
    expect(result).toContain("Connection: close");
  });

  it("appends Connection: close when absent", () => {
    const raw = Buffer.from("GET / HTTP/1.1\r\nHost: x\r\n\r\n");
    expect(forceConnectionClose(raw).toString()).toContain("Connection: close");
  });
});

describe("createTunnelBridge", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((fn) => fn()));
  });

  it("splices raw bytes between a local TCP connection and the tunnel WS, on the requested port's subprotocol", async () => {
    const seenProtocols: (string | undefined)[] = [];
    const mock = await startMockTunnelServer((conn) => {
      seenProtocols.push(conn.protocol);
      conn.onMessage((data) => conn.send(Buffer.concat([Buffer.from("echo:"), data])));
    });
    cleanups.push(mock.close);

    const bridge = await createTunnelBridge(access(mock.url), 5432);
    cleanups.push(bridge.close);

    const received = await new Promise<Buffer>((resolve, reject) => {
      const client = net.connect(bridge.localPort, bridge.localHost, () => {
        client.write("hello-tunnel");
      });
      client.once("data", (data) => {
        resolve(data);
        client.end();
      });
      client.once("error", reject);
    });

    expect(received.toString()).toBe("echo:hello-tunnel");
    expect(seenProtocols).toEqual(["depot-tunnel.v1.port.5432"]);
  });

  it("rejects a non-loopback localHost instead of exposing an unauthenticated tunnel", async () => {
    await expect(
      createTunnelBridge(access("ws://127.0.0.1:1"), 5432, { localHost: "0.0.0.0" }),
    ).rejects.toThrow(/loopback/);
  });

  it("accepts an IPv6 loopback host and brackets it in httpUrl", async () => {
    const mock = await startMockTunnelServer((conn) => {
      conn.onMessage((data) => conn.send(data));
    });
    cleanups.push(mock.close);

    const bridge = await createTunnelBridge(access(mock.url), 5432, { localHost: "::1" });
    cleanups.push(bridge.close);

    expect(bridge.localHost).toBe("::1");
    expect(bridge.httpUrl).toBe(`http://[::1]:${bridge.localPort}`);
  });

  it("delivers bytes written before the tunnel handshake completes, in order and without loss", async () => {
    const received: Buffer[] = [];
    const mock = await startMockTunnelServer(
      (conn) => {
        conn.onMessage((data) => received.push(data));
      },
      { handshakeDelayMs: 50 },
    );
    cleanups.push(mock.close);

    const bridge = await createTunnelBridge(access(mock.url), 5432);
    cleanups.push(bridge.close);

    const client = net.connect(bridge.localPort, bridge.localHost);
    await new Promise<void>((resolve) => client.once("connect", resolve));
    // Written immediately after connect, well before the delayed WS
    // handshake resolves — must be queued (not dropped) and forwarded once
    // the tunnel opens.
    client.write("part-1;");
    client.write("part-2;");
    cleanups.push(() => {
      client.end();
      return Promise.resolve();
    });

    await vi.waitFor(() => {
      expect(Buffer.concat(received).toString()).toBe("part-1;part-2;");
    });
  });

  it("delivers bytes to a slow local reader without loss when the socket applies backpressure", async () => {
    const mock = await startMockTunnelServer((conn) => {
      conn.onMessage((data) => conn.send(data));
    });
    cleanups.push(mock.close);

    const bridge = await createTunnelBridge(access(mock.url), 5432);
    cleanups.push(bridge.close);

    // Kept under the mock server's single-frame length limit (its `send`
    // helper only implements the 7-bit/16-bit WS length forms); large
    // enough on loopback to make `socket.write()` on the bridge's local
    // side return false at least once against a deliberately slow reader.
    const chunk = Buffer.alloc(60 * 1024, "x");

    const received = await new Promise<Buffer>((resolve, reject) => {
      const client = net.connect(bridge.localPort, bridge.localHost, () => {
        client.write(chunk);
      });
      const parts: Buffer[] = [];
      let total = 0;
      client.pause();
      // Simulate a slow reader: only resume briefly, on an interval, so the
      // echoed response can't drain as fast as it arrives.
      const resumer = setInterval(() => {
        client.resume();
        setTimeout(() => client.pause(), 5);
      }, 15);
      client.on("data", (data: Buffer) => {
        parts.push(data);
        total += data.length;
        if (total >= chunk.length) {
          clearInterval(resumer);
          resolve(Buffer.concat(parts));
          client.end();
        }
      });
      client.once("error", reject);
    });

    expect(received.length).toBe(chunk.length);
    expect(received.equals(chunk)).toBe(true);
  }, 10_000);

  it("terminates the connection instead of growing the downstream queue without bound", async () => {
    const mock = await startMockTunnelServer((conn) => {
      // The native WebSocket has no way to pause "message" delivery, so a
      // sandbox sending faster than a slow local reader drains must be met
      // with termination past the watermark, not unbounded buffering.
      // Frames capped at 60KB (the mock server's single-frame length
      // limit) so several are needed to cross WS_SEND_HIGH_WATERMARK.
      const frame = Buffer.alloc(60 * 1024, "y");
      const frameCount = Math.ceil((WS_SEND_HIGH_WATERMARK * 2) / frame.length);
      for (let i = 0; i < frameCount; i++) conn.send(frame);
    });
    cleanups.push(mock.close);

    const bridge = await createTunnelBridge(access(mock.url), 5432);
    cleanups.push(bridge.close);

    const totalSent = Math.ceil((WS_SEND_HIGH_WATERMARK * 2) / (60 * 1024)) * 60 * 1024;
    const received = await new Promise<number>((resolve, reject) => {
      const client = net.connect(bridge.localPort, bridge.localHost);
      let total = 0;
      client.pause();
      // A slow-but-draining reader, not a permanently paused one: Node
      // never emits 'close' on a paused Readable that still has buffered
      // unread data, so a reader that never resumes at all can't be used
      // to observe termination — it has to actually drain to see the
      // connection end (this is what proves closeBoth() fired: the total
      // received falls short of everything the mock server sent).
      const resumer = setInterval(() => {
        client.resume();
        setTimeout(() => client.pause(), 5);
      }, 15);
      client.on("data", (data: Buffer) => {
        total += data.length;
      });
      client.once("close", () => {
        clearInterval(resumer);
        resolve(total);
      });
      client.once("error", () => {
        clearInterval(resumer);
        resolve(total);
      });
      setTimeout(() => {
        clearInterval(resumer);
        reject(new Error("connection was never terminated"));
      }, 5_000);
    });

    expect(received).toBeLessThan(totalSent);
  }, 10_000);

  it("flushes queued data before ending the socket when the tunnel closes mid-transfer", async () => {
    const chunk = Buffer.alloc(60 * 1024, "z");
    const mock = await startMockTunnelServer((conn) => {
      conn.send(chunk);
      conn.close(); // closes right after sending, before the slow client can have read it
    });
    cleanups.push(mock.close);

    const bridge = await createTunnelBridge(access(mock.url), 5432);
    cleanups.push(bridge.close);

    const received = await new Promise<Buffer>((resolve, reject) => {
      const client = net.connect(bridge.localPort, bridge.localHost);
      const parts: Buffer[] = [];
      client.pause();
      // Slow reader: resume in short bursts so the transfer can't complete
      // before the tunnel's close races in.
      const resumer = setInterval(() => {
        client.resume();
        setTimeout(() => client.pause(), 5);
      }, 15);
      client.on("data", (data: Buffer) => parts.push(data));
      client.once("end", () => {
        clearInterval(resumer);
        resolve(Buffer.concat(parts));
      });
      client.once("error", reject);
    });

    expect(received.length).toBe(chunk.length);
    expect(received.equals(chunk)).toBe(true);
  }, 10_000);
});

describe("createBackpressureController", () => {
  function fakeSource(initialBuffered = 0) {
    let buffered = initialBuffered;
    let open = true;
    let paused = false;
    return {
      setBuffered: (n: number) => {
        buffered = n;
      },
      setOpen: (v: boolean) => {
        open = v;
      },
      get paused() {
        return paused;
      },
      source: {
        getBufferedAmount: () => buffered,
        isOpen: () => open,
        pause: () => {
          paused = true;
        },
        resume: () => {
          paused = false;
        },
        isPaused: () => paused,
      },
    };
  }

  it("does not pause while buffered data stays at or below the high watermark", () => {
    const fake = fakeSource();
    const controller = createBackpressureController(fake.source);
    fake.setBuffered(WS_SEND_HIGH_WATERMARK);
    controller.check();
    expect(fake.paused).toBe(false);
    controller.dispose();
  });

  it("pauses once buffered data exceeds the high watermark", () => {
    const fake = fakeSource();
    const controller = createBackpressureController(fake.source);
    fake.setBuffered(WS_SEND_HIGH_WATERMARK + 1);
    controller.check();
    expect(fake.paused).toBe(true);
    controller.dispose();
  });

  it("resumes once buffered data drains at or below the low watermark", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeSource();
      const controller = createBackpressureController(fake.source);
      fake.setBuffered(WS_SEND_HIGH_WATERMARK + 1);
      controller.check();
      expect(fake.paused).toBe(true);

      fake.setBuffered(WS_SEND_LOW_WATERMARK + 1);
      await vi.advanceTimersByTimeAsync(20);
      expect(fake.paused).toBe(true); // still above the low watermark

      fake.setBuffered(WS_SEND_LOW_WATERMARK);
      await vi.advanceTimersByTimeAsync(20);
      expect(fake.paused).toBe(false);
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resumes if the destination closes while paused, even above the low watermark", async () => {
    vi.useFakeTimers();
    try {
      const fake = fakeSource();
      const controller = createBackpressureController(fake.source);
      fake.setBuffered(WS_SEND_HIGH_WATERMARK + 1);
      controller.check();
      expect(fake.paused).toBe(true);

      fake.setOpen(false);
      await vi.advanceTimersByTimeAsync(20);
      expect(fake.paused).toBe(false);
      controller.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not start a second poll timer while already paused", () => {
    const fake = fakeSource();
    const controller = createBackpressureController(fake.source);
    fake.setBuffered(WS_SEND_HIGH_WATERMARK + 1);
    controller.check();
    controller.check(); // must not throw or double-schedule
    expect(fake.paused).toBe(true);
    controller.dispose();
  });
});

describe("createCdpTunnelBridge", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    await Promise.all(cleanups.splice(0).map((fn) => fn()));
  });

  it("rewrites webSocketDebuggerUrl in a discovery response to the local bridge address", async () => {
    const mock = await startMockTunnelServer((conn) => {
      conn.onMessage(() => {
        const body = '{"webSocketDebuggerUrl":"ws://127.0.0.1:9222/devtools/browser/abc"}';
        conn.send(
          Buffer.from(
            `HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: ${body.length}\r\n\r\n${body}`,
          ),
        );
        conn.close();
      });
    });
    cleanups.push(mock.close);

    const bridge = await createCdpTunnelBridge(access(mock.url), 9222);
    cleanups.push(bridge.close);

    const response = await fetch(`${bridge.httpUrl}/json/version`);
    const body = await response.json();
    expect(body.webSocketDebuggerUrl).toBe(
      `ws://${bridge.localHost}:${bridge.localPort}/devtools/browser/abc`,
    );
  });

  it("passes a WebSocket upgrade through untouched, without rewriting", async () => {
    const mock = await startMockTunnelServer((conn) => {
      conn.onMessage((data) => conn.send(data)); // raw echo, as Chrome's CDP handshake would be
    });
    cleanups.push(mock.close);

    const bridge = await createCdpTunnelBridge(access(mock.url), 9222);
    cleanups.push(bridge.close);

    const received = await new Promise<Buffer>((resolve, reject) => {
      const client = net.connect(bridge.localPort, bridge.localHost, () => {
        client.write(
          "GET /devtools/browser/abc HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
        );
      });
      client.once("data", (data) => {
        resolve(data);
        client.end();
      });
      client.once("error", reject);
    });

    // Passthrough mode forwards the raw request bytes verbatim through the
    // tunnel; the mock echoes them straight back, so the client sees its
    // own request bytes unmodified — proof nothing rewrote or reframed them.
    expect(received.toString()).toContain("GET /devtools/browser/abc HTTP/1.1");
    expect(received.toString()).toContain("Upgrade: websocket");
  });
});
