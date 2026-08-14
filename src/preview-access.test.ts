import { describe, expect, it, vi } from "vitest";
import {
  fetchPreviewJsonVersion,
  normalizePreviewCode,
  previewAuthHeaders,
  previewOriginFromHandoffUrl,
  resolveCdpEndpoint,
  rewriteCdpWebSocketUrl,
  withPreviewAccessToken,
} from "./preview-access";

const HANDOFF =
  "https://55ca5fbe-6d11-4610-82bf-0451b2141462-9222-tcp.cbx-de-2.zei.sh/_depot/auth?code=eyJhbGciOiJFZERTQSJ9.x.y&return=%2F";
const ORIGIN =
  "https://55ca5fbe-6d11-4610-82bf-0451b2141462-9222-tcp.cbx-de-2.zei.sh";

describe("previewOriginFromHandoffUrl", () => {
  it("strips /_depot/auth to clean origin", () => {
    expect(previewOriginFromHandoffUrl(HANDOFF)).toBe(ORIGIN);
  });

  it("prevents the path-append bug that produced return=%2F/json/version", () => {
    const base = previewOriginFromHandoffUrl(HANDOFF);
    expect(`${base}/json/version`).toBe(`${ORIGIN}/json/version`);
    expect(`${base}/json/version`).not.toContain("return=");
  });
});

describe("normalizePreviewCode", () => {
  it("maps Edge base_url / handoff_url (preferred)", () => {
    const out = normalizePreviewCode({
      url: HANDOFF,
      handoff_url: HANDOFF,
      base_url: ORIGIN,
      code: "jwt-here",
      expires_at: "2026-01-01T00:00:00.000Z",
    });
    expect(out.baseUrl).toBe(ORIGIN);
    expect(out.handoffUrl).toBe(HANDOFF);
    expect(out.url).toBe(HANDOFF);
    expect(out.token).toBe("jwt-here");
    expect(out.code).toBe("jwt-here");
    expect(out.headers).toEqual({
      Authorization: "Bearer jwt-here",
      Accept: "application/json",
    });
  });

  it("falls back to parsing handoff url for older Edge responses", () => {
    const out = normalizePreviewCode({
      url: HANDOFF,
      code: "jwt-here",
      expires_at: "2026-01-01T00:00:00.000Z",
    });
    expect(out.baseUrl).toBe(ORIGIN);
  });

  it("is idempotent", () => {
    const once = normalizePreviewCode({
      url: HANDOFF,
      base_url: ORIGIN,
      code: "t",
      expires_at: "e",
    });
    const twice = normalizePreviewCode(once);
    expect(twice).toEqual(once);
  });
});

describe("rewriteCdpWebSocketUrl", () => {
  it("rewrites loopback CDP to public host with ?token=", () => {
    expect(
      rewriteCdpWebSocketUrl(
        "ws://127.0.0.1:9222/devtools/browser/abc",
        ORIGIN,
        "tok",
      ),
    ).toBe(`${ORIGIN.replace("https:", "wss:")}/devtools/browser/abc?token=tok`);
  });

  it("uses ws when base is http", () => {
    expect(
      rewriteCdpWebSocketUrl(
        "ws://127.0.0.1:9222/devtools/browser/x",
        "http://localhost:18080",
      ),
    ).toBe("ws://localhost:18080/devtools/browser/x");
  });
});

describe("resolveCdpEndpoint", () => {
  it("combines preview + Chrome json/version for connectOverCDP", () => {
    const ep = resolveCdpEndpoint({
      preview: { url: HANDOFF, code: "tok", expires_at: "e" },
      webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/id",
    });
    expect(ep.baseUrl).toBe(ORIGIN);
    expect(ep.headers.Authorization).toBe("Bearer tok");
    expect(ep.wsUrl).toContain("?token=tok");
    expect(ep.wsUrl).toContain("wss://");
  });
});

describe("previewAuthHeaders / withPreviewAccessToken", () => {
  it("builds bearer headers", () => {
    expect(previewAuthHeaders("abc")).toEqual({
      Authorization: "Bearer abc",
      Accept: "application/json",
    });
  });

  it("sets token query on existing path", () => {
    expect(withPreviewAccessToken("wss://h.example/path", "x")).toBe(
      "wss://h.example/path?token=x",
    );
  });
});

describe("fetchPreviewJsonVersion", () => {
  it("calls clean baseUrl with Bearer, never /_depot/auth", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          webSocketDebuggerUrl: "ws://127.0.0.1:9222/devtools/browser/1",
          Browser: "Chrome",
        }),
        { status: 200 },
      ),
    );

    const body = await fetchPreviewJsonVersion(
      { url: HANDOFF, code: "jwt", expires_at: "e" },
      { fetchImpl, timeoutMs: 5_000 },
    );

    expect(body.Browser).toBe("Chrome");
    expect(fetchImpl).toHaveBeenCalledWith(
      `${ORIGIN}/json/version`,
      expect.objectContaining({
        headers: {
          Authorization: "Bearer jwt",
          Accept: "application/json",
        },
        redirect: "manual",
      }),
    );
    const calledUrl = String(fetchImpl.mock.calls[0]?.[0]);
    expect(calledUrl).not.toContain("_depot");
    expect(calledUrl).not.toContain("code=");
  });
});
