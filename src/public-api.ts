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
} from "./zeish.types.js";
import { clampPreviewTtlSeconds } from "./constants.js";
import { normalizePreviewCode } from "./preview-access.js";

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
  const fetchImpl = config.fetch ?? globalThis.fetch;
  if (!fetchImpl)
    throw new Error(
      "A Fetch API implementation is required to use the Zeish public API.",
    );

  const baseUrl = (config.baseUrl ?? defaultBaseUrl).replace(/\/+$/, "");
  const response = await fetchImpl(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-API-Key": config.apiKey,
      ...init.headers,
    },
  });

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

function mutation(config: ZeishConfig, init: RequestInit): RequestInit {
  return {
    ...init,
    headers: { "Idempotency-Key": idempotencyKey(config), ...init.headers },
  };
}

/** Typed client for the versioned Edge public API. */
export function createZeishApi(config: ZeishConfig): ZeishPublicApi {
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
    request<ZeishSandbox>(
      config,
      `${sandboxPath(sandboxId)}/${action}`,
      mutation(config, { method: "POST" }),
    );

  return {
    createSandbox: (input) =>
      request<ZeishSandbox>(
        config,
        "/public/sandboxes",
        mutation(config, { method: "POST", body: JSON.stringify(input) }),
      ),
    listSandboxes: (options: ZeishPageOptions = {}) =>
      request<ZeishSandboxPage>(
        config,
        `/public/sandboxes${queryString(options)}`,
      ),
    getSandbox: (sandboxId) =>
      request<ZeishSandbox>(config, sandboxPath(sandboxId)),
    sharePort: (sandboxId, port, policy: ZeishPortAccessPolicy) =>
      request<ZeishSandbox>(
        config,
        `${sandboxPath(sandboxId)}/ports/${port}/share`,
        mutation(config, {
          method: "PUT",
          body: JSON.stringify({ policy }),
        }),
      ),
    destroySandbox: (sandboxId) =>
      request<ZeishSandbox>(
        config,
        sandboxPath(sandboxId),
        mutation(config, { method: "DELETE" }),
      ),
    getExecAccess: (sandboxId) =>
      request<ZeishAccess>(config, `${sandboxPath(sandboxId)}/exec-access`),
    getTerminalUrl: (sandboxId) =>
      request<ZeishTerminalUrlResponse>(
        config,
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
      const raw = await request<{
        url: string;
        code: string;
        expires_at: string;
        base_url?: string;
        handoff_url?: string;
      }>(
        config,
        `${sandboxPath(sandboxId)}/preview-codes`,
        mutation(config, {
          method: "POST",
          body: JSON.stringify(normalized),
        }),
      );
      return normalizePreviewCode(raw);
    },
    listLogs: (sandboxId, options: ZeishListLogsOptions = {}) =>
      request<ZeishLogEntry[]>(
        config,
        `${sandboxPath(sandboxId)}/logs${queryString(options)}`,
      ),
    listEvents: (sandboxId, options: ZeishListEventsOptions = {}) =>
      request<ZeishSandboxEvent[]>(
        config,
        `${sandboxPath(sandboxId)}/events${queryString(options)}`,
      ),
    startSandbox: (sandboxId) => lifecycle(sandboxId, "start"),
    pauseSandbox: (sandboxId) => lifecycle(sandboxId, "pause"),
    resumeSandbox: (sandboxId) => lifecycle(sandboxId, "resume"),
    stopSandbox: (sandboxId) => lifecycle(sandboxId, "stop"),
    killSandbox: (sandboxId) => lifecycle(sandboxId, "kill"),
    createSnapshot: (sandboxId, displayName) =>
      request<ZeishSnapshot>(
        config,
        `${sandboxPath(sandboxId)}/snapshots`,
        mutation(config, {
          method: "POST",
          body: JSON.stringify({ displayName }),
        }),
      ),
    listSnapshots: (sandboxId) =>
      request<ZeishSnapshot[]>(config, `${sandboxPath(sandboxId)}/snapshots`),
    deleteSnapshot: (sandboxId, snapshotId) =>
      request<ZeishOperationResult>(
        config,
        `${sandboxPath(sandboxId)}/snapshots/${encodeURIComponent(snapshotId)}`,
        mutation(config, { method: "DELETE" }),
      ),
    createVolume: (input: ZeishCreateVolumeInput) =>
      request<ZeishVolume>(
        config,
        "/public/volumes",
        mutation(config, { method: "POST", body: JSON.stringify(input) }),
      ),
    listVolumes: (options: ZeishPageOptions = {}) =>
      request<ZeishPage<ZeishVolume>>(
        config,
        `/public/volumes${queryString(options)}`,
      ),
    getVolume: (volumeId) => request<ZeishVolume>(config, volumePath(volumeId)),
    deleteVolume: (volumeId) =>
      request<ZeishVolume>(
        config,
        volumePath(volumeId),
        mutation(config, { method: "DELETE" }),
      ),
    createNetwork: (input: ZeishCreateNetworkInput) =>
      request<ZeishNetwork>(
        config,
        "/public/networks",
        mutation(config, { method: "POST", body: JSON.stringify(input) }),
      ),
    listNetworks: (options: ZeishPageOptions = {}) =>
      request<ZeishPage<ZeishNetwork>>(
        config,
        `/public/networks${queryString(options)}`,
      ),
    getNetwork: (networkId) =>
      request<ZeishNetwork>(config, networkPath(networkId)),
    deleteNetwork: (networkId) =>
      request<ZeishNetwork>(
        config,
        networkPath(networkId),
        mutation(config, { method: "DELETE" }),
      ),
    listTemplates: (options: ZeishPageOptions = {}) =>
      request<ZeishPage<ZeishTemplate>>(
        config,
        `/public/templates${queryString(options)}`,
      ),
    getTemplate: (templateId) =>
      request<ZeishTemplate>(config, templatePath(templateId)),
  };
}
