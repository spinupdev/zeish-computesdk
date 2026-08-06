import { runSandboxdCommand } from './sandboxd-grpc.js';
import type { RunSandboxdCommandInput } from './sandboxd-grpc.types.js';
import { ZeishApiError, createZeishApi } from './public-api.js';
import type {
  ZeishSandboxClient,
  ZeishSandboxClientConfig,
  ZeishSandboxCommandOptions,
  ZeishSandboxFiles,
  ZeishSandboxSession,
  ZeishSandboxWaitOptions,
} from './zeish-sandbox-client.types.js';
import type {
  ZeishAccess,
  ZeishCreatePreviewCodeInput,
  ZeishCreateSandboxInput,
  ZeishFileEntry,
  ZeishFileList,
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

const accessRefreshSkewMs = 30_000;
const defaultAccessTimeoutMs = 5 * 60_000;
const defaultPollIntervalMs = 2_000;

/**
 * Creates a first-party Edge sandbox client. The client uses the public
 * control-plane API and receives short-lived data-plane credentials per
 * sandbox; callers never need to manage a second provider protocol.
 */
export function createZeishSandboxClient(
  config: ZeishSandboxClientConfig,
): ZeishSandboxClient {
  const api = createZeishApi(config);

  return {
    async create(input: ZeishCreateSandboxInput): Promise<ZeishSandboxSession> {
      return new EdgeSandboxSession(config, await api.createSandbox(input));
    },
    async get(sandboxId: string): Promise<ZeishSandboxSession> {
      return new EdgeSandboxSession(config, await api.getSandbox(sandboxId));
    },
    list(options: ZeishPageOptions = {}): Promise<ZeishSandboxPage> {
      return api.listSandboxes(options);
    },
  };
}

class EdgeSandboxSession implements ZeishSandboxSession {
  private access: ZeishAccess | undefined;
  readonly files: ZeishSandboxFiles;

  constructor(
    private readonly config: ZeishSandboxClientConfig,
    private sandbox: ZeishSandbox,
  ) {
    this.files = {
      readText: (path) => this.dataPlaneRequest(`/files/download?path=${encodeURIComponent(path)}`).then(
        (response) => response.text(),
      ),
      writeText: async (path, content) => {
        await this.dataPlaneRequest(`/files/write?path=${encodeURIComponent(path)}`, {
          method: 'PUT',
          body: content,
        });
      },
      makeDirectory: async (path) => {
        await this.dataPlaneRequest(`/files/mkdir?path=${encodeURIComponent(path)}`, {
          method: 'POST',
        });
      },
      listDirectory: async (path = '.') => {
        const response = await this.dataPlaneRequest(`/files?path=${encodeURIComponent(path)}`);
        return (await response.json() as ZeishFileList).entries;
      },
      stat: async (path) => {
        const response = await this.dataPlaneRequest(`/files/stat?path=${encodeURIComponent(path)}`);
        return await response.json() as ZeishFileStat;
      },
      exists: async (path) => (await this.files.stat(path)).exists,
      remove: async (path) => {
        await this.dataPlaneRequest(`/files/remove?path=${encodeURIComponent(path)}`, {
          method: 'POST',
        });
      },
    };
  }

  get id(): string {
    return this.sandbox.id;
  }

  details(): ZeishSandbox {
    return this.sandbox;
  }

  async refresh(): Promise<ZeishSandbox> {
    this.sandbox = await createZeishApi(this.config).getSandbox(this.id);
    return this.sandbox;
  }

  destroy(): Promise<ZeishSandbox> {
    return this.lifecycle('destroySandbox');
  }

  start(): Promise<ZeishSandbox> {
    return this.lifecycle('startSandbox');
  }

  pause(): Promise<ZeishSandbox> {
    return this.lifecycle('pauseSandbox');
  }

  resume(): Promise<ZeishSandbox> {
    return this.lifecycle('resumeSandbox');
  }

  stop(): Promise<ZeishSandbox> {
    return this.lifecycle('stopSandbox');
  }

  kill(): Promise<ZeishSandbox> {
    return this.lifecycle('killSandbox');
  }

  async getAccess(forceRefresh = false): Promise<ZeishAccess> {
    if (!forceRefresh && this.accessIsUsable()) return this.access!;
    this.access = await createZeishApi(this.config).getExecAccess(this.id);
    return this.access;
  }

  async waitForAccess(options: ZeishSandboxWaitOptions = {}): Promise<ZeishAccess> {
    const timeoutMs = options.timeoutMs ?? defaultAccessTimeoutMs;
    const pollIntervalMs = options.pollIntervalMs ?? defaultPollIntervalMs;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      try {
        return await this.getAccess(true);
      } catch (error) {
        if (!isRetryableAccessError(error) || Date.now() >= deadline) throw error;
        await delay(Math.min(pollIntervalMs, Math.max(0, deadline - Date.now())));
      }
    }
  }

  async run(command: string, options: ZeishSandboxCommandOptions = {}) {
    const input: RunSandboxdCommandInput = {
      access: await this.getAccess(),
      command,
      options: {
        timeout: options.timeoutMs,
        env: options.environment,
        cwd: options.workingDirectory,
        background: options.background,
        onStdout: options.onStdout,
        onStderr: options.onStderr,
      },
    };
    return runSandboxdCommand(input);
  }

  getTerminalUrl(): Promise<ZeishTerminalUrlResponse> {
    return createZeishApi(this.config).getTerminalUrl(this.id);
  }

  createPreviewCode(input: ZeishCreatePreviewCodeInput = {}): Promise<ZeishPreviewCode> {
    return createZeishApi(this.config).createPreviewCode(this.id, input);
  }

  listLogs(options: ZeishListLogsOptions = {}): Promise<ZeishLogEntry[]> {
    return createZeishApi(this.config).listLogs(this.id, options);
  }

  listEvents(options: ZeishListEventsOptions = {}): Promise<ZeishSandboxEvent[]> {
    return createZeishApi(this.config).listEvents(this.id, options);
  }

  createSnapshot(displayName: string): Promise<ZeishSnapshot> {
    return createZeishApi(this.config).createSnapshot(this.id, displayName);
  }

  listSnapshots(): Promise<ZeishSnapshot[]> {
    return createZeishApi(this.config).listSnapshots(this.id);
  }

  async deleteSnapshot(snapshotId: string): Promise<void> {
    await createZeishApi(this.config).deleteSnapshot(this.id, snapshotId);
  }

  private async lifecycle(
    action: 'destroySandbox' | 'startSandbox' | 'pauseSandbox' | 'resumeSandbox' | 'stopSandbox' | 'killSandbox',
  ): Promise<ZeishSandbox> {
    this.sandbox = await createZeishApi(this.config)[action](this.id);
    return this.sandbox;
  }

  private accessIsUsable(): boolean {
    return (
      this.access !== undefined &&
      new Date(this.access.expiresAt).getTime() - Date.now() > accessRefreshSkewMs
    );
  }

  private async dataPlaneRequest(path: string, init: RequestInit = {}): Promise<Response> {
    const access = await this.getAccess();
    const fetchImpl = this.config.fetch ?? globalThis.fetch;
    if (!fetchImpl) throw new Error('A Fetch API implementation is required to use the Zeish data plane.');
    const response = await fetchImpl(`${access.sandboxUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${access.token}`, ...init.headers },
    });
    if (!response.ok) {
      throw new Error(`Zeish sandbox data plane ${response.status}: ${await response.text()}`);
    }
    return response;
  }
}

function isRetryableAccessError(error: unknown): boolean {
  return error instanceof ZeishApiError && (error.status === 400 || error.status >= 500);
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
