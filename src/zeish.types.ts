export interface ZeishConfig {
  apiKey: string;
  baseUrl?: string;
  defaultTemplateId?: string;
  fetch?: typeof globalThis.fetch;
  createIdempotencyKey?: () => string;
}

export type ZeishPublicApiErrorCode =
  | "invalid_request"
  | "authentication_required"
  | "permission_denied"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "internal_error";

export interface ZeishPublicApiError {
  code: ZeishPublicApiErrorCode;
  message: string;
  requestId?: string;
  details?: Record<string, unknown>;
}

export interface ZeishPublicApiErrorResponse {
  error: ZeishPublicApiError;
}

export type ZeishSandboxStatus =
  | "initialized"
  | "pending"
  | "running"
  | "pausing"
  | "paused"
  | "resuming"
  | "stopping"
  | "stopped"
  | "suspending"
  | "cloning"
  | "destroying"
  | "failed"
  | "destroyed";

export type ZeishSandboxDriver = "firecracker" | "cloud-hypervisor";

export interface ZeishSandbox {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  labels: Record<string, string>;
  status: ZeishSandboxStatus;
  desiredStatus?: ZeishSandboxStatus;
  templateId?: string;
  driver: ZeishSandboxDriver;
  region: string;
  previewUrl?: string;
  primaryDnsName?: string;
  lastError?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ZeishManagedSandbox extends ZeishSandbox {
  config: ZeishConfig;
  access?: ZeishAccess;
}

export interface ZeishSandboxPage {
  data: ZeishSandbox[];
  nextCursor: string | null;
}

export interface ZeishVolume {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  region: string;
  sizeGb: number;
  createdAt: string;
  updatedAt: string;
}

export interface ZeishCreateVolumeInput {
  name: string;
  slug?: string;
  region: string;
  sizeGb: number;
}

export interface ZeishNetwork {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  region: string;
  createdAt: string;
}

export interface ZeishCreateNetworkInput {
  name: string;
  slug?: string;
  region: string;
}

export interface ZeishTemplate {
  id: string;
  name: string;
  description?: string;
  registryPath: string;
  cpuCores: number;
  memoryMb: number;
  machineKind: "shared" | "dedicated";
  exposedPorts: number[];
  iconUrl?: string;
  isPublic: boolean;
  scope: "global" | "organization";
  organizationId?: string | null;
  sourceTemplateId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ZeishPage<T> {
  data: T[];
  nextCursor: string | null;
}

export interface ZeishPageOptions {
  cursor?: string;
  limit?: number;
}

export interface ZeishAccess {
  sandboxUrl: string;
  sandboxRpcUrl: string;
  token: string;
  expiresAt: string;
}

export interface ZeishCreateSandboxVolumeInput {
  name: string;
  slug?: string;
  region?: string;
  sizeGb: number;
}

export interface ZeishCreateSandboxOptions {
  name: string;
  driver?: ZeishSandboxDriver;
  region?: string;
  networkId?: string;
  volumeIds?: string[];
  createVolumes?: ZeishCreateSandboxVolumeInput[];
  labels?: Record<string, string>;
  metadata?: Record<string, string>;
  exposedPorts?: number[];
  /**
   * Sent as the request's Idempotency-Key header. Without this, request()
   * mints a fresh random UUID per call (see idempotencyKey() in
   * public-api.ts), which defeats Edge's server-side idempotency store:
   * every retry — including a full re-attach after a crash — looks like a
   * brand-new request and creates a duplicate sandbox. Pass a value that's
   * stable across retries of the *same* logical create (e.g. a run id, or
   * `${runId}:${attempt}` if you intentionally want a fresh resource per
   * attempt).
   */
  idempotencyKey?: string;
}

export type ZeishCreateSandboxInput = ZeishCreateSandboxOptions &
  (
    | { template: string; templateId?: string }
    | { template?: string; templateId: string }
  );

export interface ZeishCreatePreviewCodeInput {
  port?: number;
  path?: string;
  /**
   * Preview code lifetime in seconds.
   * Edge enforces 1..3600 (see PREVIEW_CODE_TTL_* in constants.ts).
   * createZeishApi clamps out-of-range values; omit for default 300.
   * Use PREVIEW_CODE_TTL_AGENT (3600) for long Playwright CDP sessions.
   */
  ttl_seconds?: number;
}

/**
 * Preview access returned by createPreviewCode (SDK-normalized camelCase).
 *
 * Edge public contract (snake_case): url, handoff_url, base_url, code, expires_at.
 * Always use `baseUrl` + `headers` (or `token`) for server-to-server / CDP —
 * never treat handoff `url` as an HTTP base.
 */
export interface ZeishPreviewCode {
  /**
   * Browser handoff URL (`/_depot/auth?code=…&return=…`).
   * Open in a real browser only — not an HTTP base for fetch/Playwright.
   */
  url: string;
  /** JWT (machines:read, aud-bound). Prefer via `headers` or `?token=`. */
  code: string;
  expires_at: string;
  /** Explicit alias of `url` (from Edge `handoff_url`). */
  handoffUrl: string;
  /**
   * Clean preview origin from Edge `base_url`
   * (`https://{machine}-{port}-tcp.{base}`).
   */
  baseUrl: string;
  /** Same as `code`. */
  token: string;
  /** `Authorization: Bearer <token>` for fetch / connectOverCDP. */
  headers: Record<string, string>;
}

export interface ZeishTerminalUrlResponse {
  url: string | null;
}

export type ZeishLogSource = "boot" | "memory" | "app";

export interface ZeishListLogsOptions {
  limit?: number;
  service?: string;
  source?: ZeishLogSource;
}

export interface ZeishLogEntry {
  timestamp: string;
  service?: string;
  message: string;
}

export interface ZeishSandboxEvent {
  id: string;
  type: string;
  status: string;
  source: string;
  timestamp: string;
  message?: string;
}

export interface ZeishListEventsOptions {
  limit?: number;
}

export interface ZeishSnapshot {
  id: string;
  sandboxId: string;
  displayName: string;
  status: "ready" | "deleted";
  createdAt: string;
}

export interface ZeishOperationResult {
  ok: true;
}

export interface ZeishFileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: string;
}

export interface ZeishFileList {
  entries: ZeishFileEntry[];
}

export interface ZeishFileStat {
  exists: boolean;
}

export interface ZeishPublicApi {
  createSandbox(input: ZeishCreateSandboxInput): Promise<ZeishSandbox>;
  listSandboxes(options?: ZeishPageOptions): Promise<ZeishSandboxPage>;
  getSandbox(sandboxId: string): Promise<ZeishSandbox>;
  destroySandbox(sandboxId: string): Promise<ZeishSandbox>;
  getExecAccess(sandboxId: string): Promise<ZeishAccess>;
  getTerminalUrl(sandboxId: string): Promise<ZeishTerminalUrlResponse>;
  createPreviewCode(
    sandboxId: string,
    input?: ZeishCreatePreviewCodeInput,
  ): Promise<ZeishPreviewCode>;
  listLogs(
    sandboxId: string,
    options?: ZeishListLogsOptions,
  ): Promise<ZeishLogEntry[]>;
  listEvents(
    sandboxId: string,
    options?: ZeishListEventsOptions,
  ): Promise<ZeishSandboxEvent[]>;
  startSandbox(sandboxId: string): Promise<ZeishSandbox>;
  pauseSandbox(sandboxId: string): Promise<ZeishSandbox>;
  resumeSandbox(sandboxId: string): Promise<ZeishSandbox>;
  stopSandbox(sandboxId: string): Promise<ZeishSandbox>;
  killSandbox(sandboxId: string): Promise<ZeishSandbox>;
  createSnapshot(
    sandboxId: string,
    displayName: string,
  ): Promise<ZeishSnapshot>;
  listSnapshots(sandboxId: string): Promise<ZeishSnapshot[]>;
  deleteSnapshot(
    sandboxId: string,
    snapshotId: string,
  ): Promise<ZeishOperationResult>;
  createVolume(input: ZeishCreateVolumeInput): Promise<ZeishVolume>;
  listVolumes(options?: ZeishPageOptions): Promise<ZeishPage<ZeishVolume>>;
  getVolume(volumeId: string): Promise<ZeishVolume>;
  deleteVolume(volumeId: string): Promise<ZeishVolume>;
  createNetwork(input: ZeishCreateNetworkInput): Promise<ZeishNetwork>;
  listNetworks(options?: ZeishPageOptions): Promise<ZeishPage<ZeishNetwork>>;
  getNetwork(networkId: string): Promise<ZeishNetwork>;
  deleteNetwork(networkId: string): Promise<ZeishNetwork>;
  listTemplates(options?: ZeishPageOptions): Promise<ZeishPage<ZeishTemplate>>;
  getTemplate(templateId: string): Promise<ZeishTemplate>;
}
