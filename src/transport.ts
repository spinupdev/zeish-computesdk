import type { ZeishConfig, ZeishTransport } from './zeish.types';

const defaultBaseUrl = 'https://api.dvito.cloud/api/v1';
const defaultRetryAttempts = 3;
const defaultRetryDelayMs = 100;

/** Default Fetch-based transport strategy for the control-plane public API. */
export class FetchZeishTransport implements ZeishTransport {
  constructor(private readonly config: ZeishConfig) {}

  request(path: string, init: RequestInit = {}): Promise<Response> {
    const fetchImpl = this.config.fetch ?? globalThis.fetch;
    if (!fetchImpl) {
      throw new Error(
        'A Fetch API implementation is required to use the Zeish public API.',
      );
    }

    const baseUrl = (this.config.baseUrl ?? defaultBaseUrl).replace(/\/+$/, '');
    return fetchImpl(`${baseUrl}${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.config.apiKey,
        ...init.headers,
      },
    });
  }
}

/** Decorator that retries idempotent reads on transient control-plane failures. */
export function withTransientRetry(
  transport: ZeishTransport,
  attempts = defaultRetryAttempts,
  delayMs = defaultRetryDelayMs,
): ZeishTransport {
  return {
    async request(path, init = {}) {
      const method = (init.method ?? 'GET').toUpperCase();
      const retryable = method === 'GET' || method === 'HEAD';
      let response: Response | undefined;
      let lastError: unknown;

      for (let attempt = 1; attempt <= (retryable ? attempts : 1); attempt++) {
        try {
          response = await transport.request(path, init);
        } catch (error) {
          lastError = error;
          if (!retryable || attempt === attempts) throw error;
          await wait(delayMs * attempt);
          continue;
        }
        if (!retryable || !isTransient(response.status) || attempt === attempts) {
          return response;
        }
        await wait(delayMs * attempt);
      }

      if (lastError !== undefined) throw lastError;
      return response!;
    },
  };
}

function isTransient(status: number): boolean {
  return status === 429 || status >= 500;
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export function createZeishTransport(config: ZeishConfig): ZeishTransport {
  return withTransientRetry(new FetchZeishTransport(config));
}
