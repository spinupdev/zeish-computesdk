import { describe, expect, it, vi } from 'vitest';
import { createZeishSandboxClient } from './zeish-sandbox-client.js';

const sandbox = {
  id: 'sandbox-1',
  organizationId: 'org-1',
  name: 'Arin run',
  slug: 'arin-run',
  labels: { arin_run_id: 'run-1' },
  status: 'running' as const,
  driver: 'firecracker' as const,
  region: 'bremen',
  createdAt: '2026-08-06T00:00:00.000Z',
  updatedAt: '2026-08-06T00:00:00.000Z',
};

describe('createZeishSandboxClient', () => {
  it('uses Edge control-plane and scoped data-plane credentials for an agent run', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((url, init) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/public/sandboxes')) {
        expect(init).toMatchObject({ method: 'POST' });
        return Promise.resolve(new Response(JSON.stringify(sandbox), { status: 201 }));
      }
      if (requestUrl.endsWith('/public/sandboxes/sandbox-1/exec-access')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              sandboxUrl: 'https://sandbox.example',
              sandboxRpcUrl: 'https://sandbox-rpc.example',
              token: 'session-token',
              expiresAt: '2099-01-01T00:00:00.000Z',
            }),
            { status: 200 },
          ),
        );
      }
      if (requestUrl === 'https://sandbox.example/files/write?path=work%2Finput.txt') {
        expect(init).toMatchObject({
          method: 'PUT',
          body: 'hello',
          headers: expect.objectContaining({ Authorization: 'Bearer session-token' }),
        });
        return Promise.resolve(new Response(null, { status: 204 }));
      }
      if (requestUrl === 'https://sandbox.example/files/download?path=work%2Finput.txt') {
        return Promise.resolve(new Response('hello', { status: 200 }));
      }
      throw new Error(`Unexpected request ${requestUrl}`);
    });
    const client = createZeishSandboxClient({
      apiKey: 'zeish_live_test',
      baseUrl: 'https://edge.example/api/v1',
      createIdempotencyKey: () => 'request-1',
      fetch,
    });

    const session = await client.create({
      name: 'Arin run',
      templateId: 'arin-browser-template',
      metadata: { arinRunId: 'run-1' },
    });

    await session.files.writeText('work/input.txt', 'hello');
    await expect(session.files.readText('work/input.txt')).resolves.toBe('hello');

    expect(session.details()).toEqual(sandbox);
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it('keeps sandbox-scoped lifecycle and snapshot actions on the session', async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((url) => {
      const requestUrl = String(url);
      if (requestUrl.endsWith('/public/sandboxes/sandbox-1')) {
        return Promise.resolve(new Response(JSON.stringify(sandbox), { status: 200 }));
      }
      if (requestUrl.endsWith('/public/sandboxes/sandbox-1/start')) {
        return Promise.resolve(new Response(JSON.stringify(sandbox), { status: 200 }));
      }
      if (requestUrl.endsWith('/public/sandboxes/sandbox-1/snapshots')) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 'snapshot-1',
              sandboxId: 'sandbox-1',
              displayName: 'before-run',
              status: 'ready',
              createdAt: '2026-08-06T00:00:00.000Z',
            }),
            { status: 201 },
          ),
        );
      }
      throw new Error(`Unexpected request ${requestUrl}`);
    });
    const client = createZeishSandboxClient({
      apiKey: 'zeish_live_test',
      createIdempotencyKey: () => 'request-1',
      fetch,
    });
    const session = await client.get('sandbox-1');

    await session.start();
    await expect(session.createSnapshot('before-run')).resolves.toMatchObject({
      id: 'snapshot-1',
      sandboxId: 'sandbox-1',
    });
  });
});
