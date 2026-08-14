import { describe, expect, it, vi } from 'vitest';
import { withTransientRetry } from './transport';

describe('transport strategies', () => {
  it('retries transient reads but never retries mutations', async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const transport = withTransientRetry({ request }, 3, 0);

    await expect(transport.request('/sandboxes')).resolves.toHaveProperty('status', 200);
    expect(request).toHaveBeenCalledTimes(2);

    request.mockReset();
    request.mockResolvedValue(new Response(null, { status: 503 }));
    const mutationTransport = withTransientRetry({ request }, 3, 0);

    await expect(mutationTransport.request('/sandboxes', { method: 'POST' }))
      .resolves.toHaveProperty('status', 503);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('retries thrown read failures', async () => {
    const request = vi.fn()
      .mockRejectedValueOnce(new Error('connection reset'))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    const transport = withTransientRetry({ request }, 3, 0);

    await expect(transport.request('/sandboxes')).resolves.toHaveProperty('status', 200);
    expect(request).toHaveBeenCalledTimes(2);
  });
});
