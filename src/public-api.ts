import type {
  ZeishAccess,
  ZeishConfig,
  ZeishCreateNetworkInput,
  ZeishCreatePreviewCodeInput,
  ZeishCreateSandboxInput,
  ZeishCreateVolumeInput,
  ZeishListEventsOptions,
  ZeishListLogsOptions,
  ZeishLogEntry,
  ZeishNetwork,
  ZeishOperationResult,
  ZeishPage,
  ZeishPageOptions,
  ZeishPortAccessPolicy,
  ZeishPreviewCode,
  ZeishPublicApiError,
  ZeishPublicApiErrorResponse,
  ZeishPublicApi,
  ZeishSandbox,
  ZeishSandboxEvent,
  ZeishSandboxPage,
  ZeishSnapshot,
  ZeishTemplate,
  ZeishTerminalUrlResponse,
  ZeishVolume,
  ZeishPreviewCodeResponse,
} from "./zeish.types";
import { clampPreviewTtlSeconds } from "./constants";
import { normalizePreviewCode } from "./preview-access";
import { createZeishTransport } from './transport';

/** Default Edge public API base (override with ZEISH_BASE_URL / config.baseUrl). */
export const defaultBaseUrl = "https://api.dvito.cloud/api/v1";

export class ZeishApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly method: string,
    public readonly path: string,
    public readonly error?: ZeishPublicApiError,
  ) {
    const message = error?.message
      ? `Zeish API ${status} (${method} ${path}): ${error.message}`
      : `Zeish API ${status} (${method} ${path}): ${body}`;
    super(message);
    this.name = "ZeishApiError";
  }

  get code(): string | undefined {
    return this.error?.code;
  }

  get details(): Record<string, unknown> | undefined {
    return this.error?.details;
  }

  /** True when Edge rejected request shape (e.g. ttl_seconds too_big). */
  get isValidationError(): boolean {
    return this.status === 400 && this.error?.code === "invalid_request";
  }
}

function parsePublicApiError(body: string): ZeishPublicApiError | undefined {
  try {
    const payload = JSON.parse(body) as Partial<ZeishPublicApiErrorResponse>;
    if (
      payload.error &&
      typeof payload.error.code === "string" &&
      typeof payload.error.message === "string"
    ) {
      return payload.error;
    }
  } catch {
    // Preserve non-JSON responses verbatim for transport and proxy errors.
  }
  return undefined;
}

function idempotencyKey(config: ZeishConfig): string {
  if (config.createIdempotencyKey) return config.createIdempotencyKey();
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  throw new Error(
    "Provide createIdempotencyKey when crypto.randomUUID is unavailable.",
  );
}

export async function request<T>(
  config: ZeishConfig,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const transport = config.transport ?? createZeishTransport(config);
  return parseResponse<T>(transport.request(path, init), path, init);
}

async function parseResponse<T>(
  responsePromise: Response | Promise<Response>,
  path: string,
  init: RequestInit,
): Promise<T> {
  const response = await responsePromise;

  if (!response.ok) {
    const body = await response.text();
    throw new ZeishApiError(
      response.status,
      body,
      init.method ?? "GET",
      path,
      parsePublicApiError(body),
    );
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function queryString(values: object): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" || typeof value === "number")
      query.set(key, String(value));
  }
  const encoded = query.toString();
  return encoded ? `?${encoded}` : "";
}

function mutation(
  config: ZeishConfig,
  init: RequestInit,
  overrideKey?: string,
): RequestInit {
  return {
    ...init,
    headers: {
      "Idempotency-Key": overrideKey ?? idempotencyKey(config),
      ...init.headers,
    },
  };
}

/** Typed client for the versioned Edge public API. */
export function createZeishApi(config: ZeishConfig): ZeishPublicApi {
  const transport = config.transport ?? createZeishTransport(config);
  const apiRequest = <T>(path: string, init: RequestInit = {}) =>
    parseResponse<T>(transport.request(path, init), path, init);
  const sandboxPath = (sandboxId: string) =>
    `/public/sandboxes/${encodeURIComponent(sandboxId)}`;
  const networkPath = (networkId: string) =>
    `/public/networks/${encodeURIComponent(networkId)}`;
  const volumePath = (volumeId: string) =>
    `/public/volumes/${encodeURIComponent(volumeId)}`;
  const templatePath = (templateId: string) =>
    `/public/templates/${encodeURIComponent(templateId)}`;
  const lifecycle = (
    sandboxId: string,
    action: "start" | "pause" | "resume" | "stop" | "kill",
  ) =>
    apiRequest<ZeishSandbox>(
      `${sandboxPath(sandboxId)}/${action}`,
      mutation(config, { method: "POST" }),
    );

  return {
    createSandbox: ({ idempotencyKey: key, ...input }) =>
      apiRequest<ZeishSandbox>(
        "/public/sandboxes",
        mutation(
          config,
          { method: "POST", body: JSON.stringify(input) },
          key,
        ),
      ),
    listSandboxes: (options: ZeishPageOptions = {}) =>
      apiRequest<ZeishSandboxPage>(
        `/public/sandboxes${queryString(options)}`,
      ),
    async *iterateSandboxes(
      options: ZeishPageOptions = {},
    ): AsyncIterable<ZeishSandbox> {
      let cursor = options.cursor;
      do {
        const page = await apiRequest<ZeishSandboxPage>(
          `/public/sandboxes${queryString({
            ...options,
            ...(cursor ? { cursor } : {}),
          })}`,
        );
        yield* page.data;
        cursor = page.nextCursor ?? undefined;
      } while (cursor);
    },
    getSandbox: (sandboxId) =>
      apiRequest<ZeishSandbox>(sandboxPath(sandboxId)),
    sharePort: (sandboxId, port, policy: ZeishPortAccessPolicy) =>
      apiRequest<ZeishSandbox>(
        `${sandboxPath(sandboxId)}/ports/${port}/share`,
        mutation(config, {
          method: "PUT",
          body: JSON.stringify({ policy }),
        }),
      ),
    destroySandbox: (sandboxId) =>
      apiRequest<ZeishSandbox>(
        sandboxPath(sandboxId),
        mutation(config, { method: "DELETE" }),
      ),
    getExecAccess: (sandboxId) =>
      apiRequest<ZeishAccess>(`${sandboxPath(sandboxId)}/exec-access`),
    getTerminalUrl: (sandboxId) =>
      apiRequest<ZeishTerminalUrlResponse>(
        `${sandboxPath(sandboxId)}/terminal-url`,
      ),
    createPreviewCode: async (sandboxId, input = {}) => {
      // Clamp ttl_seconds to Edge contract (1..PREVIEW_CODE_TTL_MAX) before send.
      const normalized: ZeishCreatePreviewCodeInput = {
        ...input,
        ttl_seconds: clampPreviewTtlSeconds(input.ttl_seconds),
      };
      // Edge PreviewCode: url, handoff_url, base_url, code, expires_at.
      // Normalize to camelCase + Bearer headers for agents.
      const raw = await apiRequest<ZeishPreviewCodeResponse>(
        `${sandboxPath(sandboxId)}/preview-codes`,
        mutation(config, {
          method: "POST",
          body: JSON.stringify(normalized),
        }),
      );
      return normalizePreviewCode(raw);
    },
    listLogs: (sandboxId, options: ZeishListLogsOptions = {}) =>
      apiRequest<ZeishLogEntry[]>(
        `${sandboxPath(sandboxId)}/logs${queryString(options)}`,
      ),
    listEvents: (sandboxId, options: ZeishListEventsOptions = {}) =>
      apiRequest<ZeishSandboxEvent[]>(
        `${sandboxPath(sandboxId)}/events${queryString(options)}`,
      ),
    startSandbox: (sandboxId) => lifecycle(sandboxId, "start"),
    pauseSandbox: (sandboxId) => lifecycle(sandboxId, "pause"),
    resumeSandbox: (sandboxId) => lifecycle(sandboxId, "resume"),
    stopSandbox: (sandboxId) => lifecycle(sandboxId, "stop"),
    killSandbox: (sandboxId) => lifecycle(sandboxId, "kill"),
    createSnapshot: (sandboxId, displayName) =>
      apiRequest<ZeishSnapshot>(
        `${sandboxPath(sandboxId)}/snapshots`,
        mutation(config, {
          method: "POST",
          body: JSON.stringify({ displayName }),
        }),
      ),
    listSnapshots: (sandboxId) =>
      apiRequest<ZeishSnapshot[]>(`${sandboxPath(sandboxId)}/snapshots`),
    deleteSnapshot: (sandboxId, snapshotId) =>
      apiRequest<ZeishOperationResult>(
        `${sandboxPath(sandboxId)}/snapshots/${encodeURIComponent(snapshotId)}`,
        mutation(config, { method: "DELETE" }),
      ),
    createVolume: (input: ZeishCreateVolumeInput) =>
      apiRequest<ZeishVolume>(
        "/public/volumes",
        mutation(config, { method: "POST", body: JSON.stringify(input) }),
      ),
    listVolumes: (options: ZeishPageOptions = {}) =>
      apiRequest<ZeishPage<ZeishVolume>>(
        `/public/volumes${queryString(options)}`,
      ),
    getVolume: (volumeId) => apiRequest<ZeishVolume>(volumePath(volumeId)),
    deleteVolume: (volumeId) =>
      apiRequest<ZeishVolume>(
        volumePath(volumeId),
        mutation(config, { method: "DELETE" }),
      ),
    createNetwork: (input: ZeishCreateNetworkInput) =>
      apiRequest<ZeishNetwork>(
        "/public/networks",
        mutation(config, { method: "POST", body: JSON.stringify(input) }),
      ),
    listNetworks: (options: ZeishPageOptions = {}) =>
      apiRequest<ZeishPage<ZeishNetwork>>(
        `/public/networks${queryString(options)}`,
      ),
    getNetwork: (networkId) =>
      apiRequest<ZeishNetwork>(networkPath(networkId)),
    deleteNetwork: (networkId) =>
      apiRequest<ZeishNetwork>(
        networkPath(networkId),
        mutation(config, { method: "DELETE" }),
      ),
    listTemplates: (options: ZeishPageOptions = {}) =>
      apiRequest<ZeishPage<ZeishTemplate>>(
        `/public/templates${queryString(options)}`,
      ),
    getTemplate: (templateId) =>
      apiRequest<ZeishTemplate>(templatePath(templateId)),
  };
}
