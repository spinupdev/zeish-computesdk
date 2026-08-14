import { describe, expect, it, vi } from "vitest";
import { createZeishApi } from "./public-api";

describe("createZeishApi", () => {
  it("uses only first-party API-key authentication and idempotency for mutations", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "sandbox-1" }), { status: 201 }),
      );
    const api = createZeishApi({
      apiKey: "zeish_live_test",
      baseUrl: "https://edge.example/api/v1",
      createIdempotencyKey: () => "request-1",
      fetch,
    });

    await api.createSandbox({ name: "SDK test", template: "base" });

    expect(fetch).toHaveBeenCalledWith(
      "https://edge.example/api/v1/public/sandboxes",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          "X-API-Key": "zeish_live_test",
          "Idempotency-Key": "request-1",
        }),
      }),
    );
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty(
      "X-External-Provider",
    );
  });

  it("preserves the documented opaque page envelope", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ data: [], nextCursor: "opaque-cursor" }),
          { status: 200 },
        ),
      );
    const api = createZeishApi({ apiKey: "zeish_live_test", fetch });

    await expect(
      api.listSandboxes({ cursor: "start", limit: 20 }),
    ).resolves.toEqual({
      data: [],
      nextCursor: "opaque-cursor",
    });
  });

  it('iterates through all sandbox pages lazily', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 'sandbox-1' }], nextCursor: 'page-2',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        data: [{ id: 'sandbox-2' }], nextCursor: null,
      }), { status: 200 }));
    const api = createZeishApi({ apiKey: 'zeish_live_test', fetch });

    const ids: string[] = [];
    for await (const sandbox of api.iterateSandboxes({ limit: 1 })) {
      ids.push(sandbox.id);
    }

    expect(ids).toEqual(['sandbox-1', 'sandbox-2']);
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      'https://api.dvito.cloud/api/v1/public/sandboxes?limit=1&cursor=page-2',
      expect.anything(),
    );
  });

  it("sends explicit raw L4 ingress without route-type inference", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: "sandbox-1" }), { status: 201 }),
    );
    const api = createZeishApi({ apiKey: "zeish_live_test", fetch });

    await api.createSandbox({
      name: "UDP sandbox",
      template: "base",
      ingress: [
        { mode: "raw_l4", protocol: "udp", internalPort: 27015 },
      ],
    });

    expect(JSON.parse(String(fetch.mock.calls[0]?.[1]?.body))).toMatchObject({
      ingress: [
        { mode: "raw_l4", protocol: "udp", internalPort: 27015 },
      ],
    });
  });

  it("exposes the versioned template, network, and volume resource surface", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [], nextCursor: null }), {
          status: 200,
        }),
      ),
    );
    const api = createZeishApi({ apiKey: "zeish_live_test", fetch });

    await api.listTemplates({ limit: 20 });
    await api.listNetworks({ cursor: "network-cursor" });
    await api.listVolumes();

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://api.dvito.cloud/api/v1/public/templates?limit=20",
      "https://api.dvito.cloud/api/v1/public/networks?cursor=network-cursor",
      "https://api.dvito.cloud/api/v1/public/volumes",
    ]);
  });

  it("preserves the stable public error envelope for callers", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "rate_limited",
            message: "Too many requests",
            requestId: "request_1",
          },
        }),
        { status: 429 },
      ),
    );
    const api = createZeishApi({ apiKey: "zeish_live_test", fetch });

    await expect(api.listTemplates()).rejects.toMatchObject({
      status: 429,
      error: {
        code: "rate_limited",
        message: "Too many requests",
        requestId: "request_1",
      },
    });
  });

  it("preserves successful empty responses for delete operations", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response(null, { status: 204 }));
    const api = createZeishApi({
      apiKey: "zeish_live_test",
      createIdempotencyKey: () => "request-1",
      fetch,
    });

    await expect(api.deleteSnapshot("sandbox-1", "snapshot-1")).resolves.toBeUndefined();
  });

  it("clamps createPreviewCode ttl_seconds to Edge max", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          url: "https://p.example/_depot/auth?code=x&return=%2F",
          code: "x",
          expires_at: "t",
        }),
        { status: 200 },
      ),
    );
    const api = createZeishApi({
      apiKey: "zeish_live_test",
      createIdempotencyKey: () => "request-1",
      fetch,
    });

    await api.createPreviewCode("sb-1", { port: 9222, ttl_seconds: 999_999 });

    const body = JSON.parse(String(fetch.mock.calls[0]?.[1]?.body));
    expect(body).toMatchObject({ port: 9222, ttl_seconds: 3600 });
  });

  it("maps Edge base_url / handoff_url into agent-safe baseUrl + headers", async () => {
    const handoff =
      "https://abc-9222-tcp.example.zei.sh/_depot/auth?code=jwt-token&return=%2F";
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          url: handoff,
          handoff_url: handoff,
          base_url: "https://abc-9222-tcp.example.zei.sh",
          code: "jwt-token",
          expires_at: "2026-01-01T00:00:00.000Z",
        }),
        { status: 200 },
      ),
    );
    const api = createZeishApi({
      apiKey: "zeish_live_test",
      createIdempotencyKey: () => "request-1",
      fetch,
    });

    const preview = await api.createPreviewCode("sb-1", { port: 9222 });

    expect(preview.url).toBe(handoff);
    expect(preview.handoffUrl).toBe(handoff);
    expect(preview.baseUrl).toBe("https://abc-9222-tcp.example.zei.sh");
    expect(preview.token).toBe("jwt-token");
    expect(preview.headers).toEqual({
      Authorization: "Bearer jwt-token",
      Accept: "application/json",
    });
  });
});
