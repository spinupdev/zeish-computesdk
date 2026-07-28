import { describe, expect, it, vi } from 'vitest';
import { createZeishApi } from './public-api.js';

describe('createZeishApi', () => {
  it('uses only first-party API-key authentication and idempotency for mutations', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ id: 'sandbox-1' }), { status: 201 })
    );
    const api = createZeishApi({
      apiKey: 'zeish_live_test',
      baseUrl: 'https://edge.example/api/v1',
      createIdempotencyKey: () => 'request-1',
      fetch,
    });

    await api.createSandbox({ name: 'SDK test', template: 'base' });

    expect(fetch).toHaveBeenCalledWith(
      'https://edge.example/api/v1/public/sandboxes',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-API-Key': 'zeish_live_test',
          'Idempotency-Key': 'request-1',
        }),
      })
    );
    expect(fetch.mock.calls[0]?.[1]?.headers).not.toHaveProperty('X-External-Provider');
  });

  it('preserves the documented opaque page envelope', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      new Response(JSON.stringify({ data: [], nextCursor: 'opaque-cursor' }), { status: 200 })
    );
    const api = createZeishApi({ apiKey: 'zeish_live_test', fetch });

    await expect(api.listSandboxes({ cursor: 'start', limit: 20 })).resolves.toEqual({
      data: [],
      nextCursor: 'opaque-cursor',
    });
  });
});
