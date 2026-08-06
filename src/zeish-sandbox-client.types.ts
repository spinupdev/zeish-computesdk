import type {
  SandboxdCommandResult,
  StreamCallbackOptions,
} from './sandboxd-grpc.types.js';
import type {
  ZeishAccess,
  ZeishConfig,
  ZeishCreatePreviewCodeInput,
  ZeishCreateSandboxInput,
  ZeishFileEntry,
  ZeishFileStat,
  ZeishListEventsOptions,
  ZeishListLogsOptions,
  ZeishLogEntry,
  ZeishPageOptions,
  ZeishPreviewCode,
  ZeishSandbox,
  ZeishSandboxEvent,
  ZeishSandboxPage,
  ZeishSnapshot,
  ZeishTerminalUrlResponse,
} from './zeish.types.js';

/** Options for a command executed in the sandbox data plane. */
export interface ZeishSandboxCommandOptions extends StreamCallbackOptions {
  timeoutMs?: number;
  environment?: Record<string, string>;
  workingDirectory?: string;
  background?: boolean;
}

/** A high-level, first-party sandbox client suitable for long-running agents. */
export interface ZeishSandboxClient {
  create(input: ZeishCreateSandboxInput): Promise<ZeishSandboxSession>;
  get(sandboxId: string): Promise<ZeishSandboxSession>;
  list(options?: ZeishPageOptions): Promise<ZeishSandboxPage>;
}

/** A session owns one Edge sandbox and exposes its control- and data-plane actions. */
export interface ZeishSandboxSession {
  readonly id: string;
  readonly files: ZeishSandboxFiles;
  details(): ZeishSandbox;
  refresh(): Promise<ZeishSandbox>;
  destroy(): Promise<ZeishSandbox>;
  start(): Promise<ZeishSandbox>;
  pause(): Promise<ZeishSandbox>;
  resume(): Promise<ZeishSandbox>;
  stop(): Promise<ZeishSandbox>;
  kill(): Promise<ZeishSandbox>;
  getAccess(forceRefresh?: boolean): Promise<ZeishAccess>;
  waitForAccess(options?: ZeishSandboxWaitOptions): Promise<ZeishAccess>;
  run(command: string, options?: ZeishSandboxCommandOptions): Promise<SandboxdCommandResult>;
  getTerminalUrl(): Promise<ZeishTerminalUrlResponse>;
  createPreviewCode(input?: ZeishCreatePreviewCodeInput): Promise<ZeishPreviewCode>;
  listLogs(options?: ZeishListLogsOptions): Promise<ZeishLogEntry[]>;
  listEvents(options?: ZeishListEventsOptions): Promise<ZeishSandboxEvent[]>;
  createSnapshot(displayName: string): Promise<ZeishSnapshot>;
  listSnapshots(): Promise<ZeishSnapshot[]>;
  deleteSnapshot(snapshotId: string): Promise<void>;
}

/** Operations that run directly against the session-scoped sandboxd HTTP surface. */
export interface ZeishSandboxFiles {
  readText(path: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  makeDirectory(path: string): Promise<void>;
  listDirectory(path?: string): Promise<ZeishFileEntry[]>;
  stat(path: string): Promise<ZeishFileStat>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}

export interface ZeishSandboxWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

export type ZeishSandboxClientConfig = ZeishConfig;
