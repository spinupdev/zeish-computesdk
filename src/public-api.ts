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
  ZeishPreviewCode,
  ZeishPublicApi,
  ZeishSandbox,
  ZeishSandboxEvent,
  ZeishSandboxPage,
  ZeishSnapshot,
  ZeishTemplate,
  ZeishTerminalUrlResponse,
  ZeishVolume,
} from "./zeish.types.js";

export const defaultBaseUrl = "https://api.dvito.cloud/api/v1";

export class ZeishApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: string,
    public readonly method: string,
    public readonly path: string,
  ) {
    super(`Zeish API ${status} (${method} ${path}): ${body}`);
    this.name = "ZeishApiError";
  }
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
    throw new ZeishApiError(
      response.status,
      await response.text(),
      init.method ?? "GET",
      path,
    );
  }
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
    createPreviewCode: (sandboxId, input = {}) =>
      request<ZeishPreviewCode>(
        config,
        `${sandboxPath(sandboxId)}/preview-codes`,
        mutation(config, { method: "POST", body: JSON.stringify(input) }),
      ),
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
