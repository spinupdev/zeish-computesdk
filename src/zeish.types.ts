export interface ZeishConfig {
  apiKey: string;
  baseUrl?: string;
  defaultTemplateId?: string;
  fetch?: typeof globalThis.fetch;
  transport?: ZeishTransport;
  createIdempotencyKey?: () => string;
}

/** Strategy boundary for the Edge HTTP transport. */
export interface ZeishTransport {
  request(path: string, init?: RequestInit): Promise<Response>;
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

export type ZeishSandboxLifecycleAction =
  | 'start'
  | 'pause'
  | 'resume'
  | 'stop'
  | 'kill'
  | 'destroy';

export type ZeishSandboxDriver = "firecracker" | "cloud-hypervisor";

/** Machine-backed ingress profile. TCP and UDP share the raw L4 policy. */
export type ZeishIngressMode = "raw_l4";
export type ZeishIngressProtocol = "tcp" | "udp";

export interface ZeishIngress {
  mode: ZeishIngressMode;
  protocol: ZeishIngressProtocol;
  internalPort: number;
  externalPort?: number;
}

export interface ZeishService {
  name?: string;
  mode?: 'raw_l4';
  protocol: ZeishIngressProtocol;
  internal_port: number;
  ports: Array<{ port: number; handlers?: string[] }>;
  /** URL-based endpoint, when the transport has one. */
  url?: string;
  /** Native endpoint metadata for raw TCP/UDP transports. */
  transport?: ZeishIngressProtocol;
  host?: string;
  port?: number;
  access_policy?: 'private' | 'org' | 'public';
  access_url?: string;
  access_token?: string;
  access_headers?: Record<string, string>;
}

export interface ZeishSandboxRuntime {
  id: string;
  state: string;
  services?: ZeishService[] | null;
}

export interface ZeishSandbox {
  id: string;
  organizationId: string;
  name: string;
  slug: string;
  labels: Record<string, string>;
  status: ZeishSandboxStatus;
  desiredStatus?: ZeishSandboxStatus;
  templateId?: string;
  ingress?: ZeishIngress[];
  runtime?: ZeishSandboxRuntime | null;
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
  ingress: ZeishIngress[];
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
  /** CPU cores for this sandbox; defaults to the selected template. */
  cpu?: number;
  /** Memory in MB for this sandbox; defaults to the selected template. */
  memory?: number;
  region?: string;
  networkId?: string;
  volumeIds?: string[];
  createVolumes?: ZeishCreateSandboxVolumeInput[];
  labels?: Record<string, string>;
  metadata?: Record<string, string>;
  /** Explicit generic ingress policy for every exposed transport. */
  ingress?: ZeishIngress[];
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

export interface ZeishPreviewCodeResponse {
  url: string;
  code: string;
  expires_at: string;
  base_url?: string;
  handoff_url?: string;
}

export interface ZeishDesktopActionResponse {
  success?: boolean;
}

export type ZeishMouseButton = 'left' | 'middle' | 'right' | 'back' | 'forward';

/** Wire representation consumed by sandboxd's desktop action endpoint. */
export interface ZeishSandboxdAction {
  type: ZeishSandboxActionType;
  x?: number;
  y?: number;
  button?: ZeishMouseButton;
  clicks?: number;
  text?: string;
  key?: string;
  amount?: number;
  delta_x?: number;
  delta_y?: number;
}

export type ZeishSandboxActionType =
  | 'move'
  | 'click'
  | 'type'
  | 'key'
  | 'scroll';

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

export type ZeishPortAccessPolicy = "private" | "org" | "public";

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

export interface ZeishTunnelAccessResponse {
  ws_url: string;
  token: string;
  expires_at: string;
}

export interface ZeishCreateTunnelAccessInput {
  /**
   * Tunnel access lifetime in seconds.
   * Edge enforces 1..3600 (see TUNNEL_ACCESS_TTL_* in constants.ts).
   * createZeishApi clamps out-of-range values; omit for default 60s.
   * Use TUNNEL_ACCESS_TTL_AGENT (3600) for long Playwright CDP sessions.
   */
  ttl_seconds?: number;
}

/**
 * Tunnel access returned by createTunnelAccess (SDK-normalized camelCase).
 *
 * Unlike createPreviewCode, wsUrl is never forwarded as an HTTP request
 * carrying this hostname to the backend — proxyd's /__depot/tunnel
 * terminates the WebSocket itself and dials the backend directly, so it
 * works for raw TCP services that validate their own Host (Chrome CDP
 * included). See createCdpTunnelBridge for a ready-to-use local connector.
 */
export interface ZeishTunnelAccess {
  /** `wss://{machine}.tunnel.{base}/__depot/tunnel` — connect with a
   * `depot-tunnel.v1.port.<port>` Sec-WebSocket-Protocol and `?token=`. */
  wsUrl: string;
  /** Short-lived JWT (tunnel:connect, audience-bound to wsUrl's host). */
  token: string;
  expiresAt: string;
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
  iterateSandboxes(options?: ZeishPageOptions): AsyncIterable<ZeishSandbox>;
  getSandbox(sandboxId: string): Promise<ZeishSandbox>;
  sharePort(
    sandboxId: string,
    port: number,
    policy: ZeishPortAccessPolicy,
  ): Promise<ZeishSandbox>;
  destroySandbox(sandboxId: string): Promise<ZeishSandbox>;
  getExecAccess(sandboxId: string): Promise<ZeishAccess>;
  getTerminalUrl(sandboxId: string): Promise<ZeishTerminalUrlResponse>;
  createPreviewCode(
    sandboxId: string,
    input?: ZeishCreatePreviewCodeInput,
  ): Promise<ZeishPreviewCode>;
  createTunnelAccess(
    sandboxId: string,
    input?: ZeishCreateTunnelAccessInput,
  ): Promise<ZeishTunnelAccess>;
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
