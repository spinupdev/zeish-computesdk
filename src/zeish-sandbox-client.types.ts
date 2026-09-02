import type {
  SandboxdCommandResult,
  StreamCallbackOptions,
} from './sandboxd-grpc.types';
import type {
  ZeishAccess,
  ZeishAddSandboxPortInput,
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
  ZeishPortAccessPolicy,
  ZeishSandbox,
  ZeishSandboxEvent,
  ZeishSandboxPage,
  ZeishSnapshot,
  ZeishTerminalUrlResponse,
  ZeishMouseButton,
} from './zeish.types';

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

/** A session owns one sandbox and exposes its control- and data-plane actions. */
export interface ZeishSandboxSession {
  readonly id: string;
  readonly files: ZeishSandboxFiles;
  readonly desktop: ZeishSandboxDesktop;
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
  isDataPlaneAvailable(): Promise<boolean>;
  screenshot(): Promise<Buffer>;
  act(action: ZeishSandboxAction): Promise<void>;
  getTerminalUrl(): Promise<ZeishTerminalUrlResponse>;
  addPort(input: ZeishAddSandboxPortInput): Promise<ZeishSandbox>;
  sharePort(port: number, policy: ZeishPortAccessPolicy): Promise<ZeishSandbox>;
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

/** Native Wayland desktop controls scoped to one sandbox session. */
export interface ZeishSandboxDesktop {
  screenshot(): Promise<Buffer>;
  action(action: ZeishSandboxAction): Promise<void>;
  move(x: number, y: number): Promise<void>;
  click(input?: Omit<Extract<ZeishSandboxAction, { type: 'click' }>, 'type'>): Promise<void>;
  scroll(input: Omit<Extract<ZeishSandboxAction, { type: 'scroll' }>, 'type'>): Promise<void>;
  type(text: string): Promise<void>;
  key(key: string): Promise<void>;
}

export interface ZeishSandboxWaitOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

/** A mouse or keyboard action executed by sandboxd against the guest display. */
export type ZeishSandboxAction =
  | { type: 'move'; x: number; y: number }
  | { type: 'click'; x?: number; y?: number; button?: ZeishMouseButton; clicks?: number }
  | { type: 'type'; text: string }
  | { type: 'key'; key: string }
  | {
      type: 'scroll';
      x?: number;
      y?: number;
      amount?: number;
      deltaX?: number;
      deltaY?: number;
    };

export type ZeishSandboxClientConfig = ZeishConfig;
