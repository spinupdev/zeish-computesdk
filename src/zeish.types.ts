export interface ZeishConfig {
  apiKey: string;
  baseUrl?: string;
  defaultTemplateId?: string;
  fetch?: typeof globalThis.fetch;
  createIdempotencyKey?: () => string;
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
}

export type ZeishCreateSandboxInput = ZeishCreateSandboxOptions &
  (
    | { template: string; templateId?: string }
    | { template?: string; templateId: string }
  );

export interface ZeishCreatePreviewCodeInput {
  port?: number;
  path?: string;
  ttl_seconds?: number;
}

export interface ZeishPreviewCode {
  url: string;
  code: string;
  expires_at: string;
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
