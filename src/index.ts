import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';
import { runSandboxdCommand } from './sandboxd-grpc.js';
import { createZeishApi, ZeishApiError } from './public-api.js';
import { createZeishSandboxClient } from './zeish-sandbox-client.js';
import type {
  ZeishConfig,
  ZeishFileList,
  ZeishFileStat,
  ZeishManagedSandbox,
} from './zeish.types.js';

async function access(
  sandbox: ZeishManagedSandbox
): Promise<NonNullable<ZeishManagedSandbox['access']>> {
  if (sandbox.access && new Date(sandbox.access.expiresAt).getTime() - Date.now() > 30_000) {
    return sandbox.access;
  }

  sandbox.access = await createZeishApi(sandbox.config).getExecAccess(sandbox.id);
  return sandbox.access;
}

async function fileRequest(
  sandbox: ZeishManagedSandbox,
  path: string,
  init?: RequestInit
): Promise<Response> {
  const session = await access(sandbox);
  const fetchImpl = sandbox.config.fetch ?? globalThis.fetch;
  if (!fetchImpl) throw new Error('A Fetch API implementation is required to use the Zeish filesystem API.');
  const response = await fetchImpl(`${session.sandboxUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${session.token}`, ...init?.headers },
  });
  if (!response.ok) throw new Error(`Zeish sandbox filesystem ${response.status}: ${await response.text()}`);
  return response;
}

function managedSandbox(
  config: ZeishConfig,
  sandbox: Omit<ZeishManagedSandbox, 'config' | 'access'>
): ZeishManagedSandbox {
  return { ...sandbox, config };
}

async function listAllSandboxes(config: ZeishConfig): Promise<ZeishManagedSandbox[]> {
  const api = createZeishApi(config);
  const sandboxes: ZeishManagedSandbox[] = [];
  let cursor: string | undefined;

  do {
    const page = await api.listSandboxes({ cursor, limit: 100 });
    sandboxes.push(...page.data.map(sandbox => managedSandbox(config, sandbox)));
    cursor = page.nextCursor ?? undefined;
  } while (cursor);

  return sandboxes;
}

export const zeish = defineProvider<ZeishManagedSandbox, ZeishConfig>({
  name: 'zeish',
  methods: {
    sandbox: {
      create: async (config, options?: CreateSandboxOptions) => {
        const ingressOptions = options as CreateSandboxOptions & {
          ingress?: import('./zeish.types.js').ZeishIngress[];
        };
        const templateId = options?.templateId ?? config.defaultTemplateId;
        if (!templateId) {
          throw new Error('Zeish requires a templateId. Pass sandbox.create({ templateId }) or set defaultTemplateId in the Zeish config.');
        }
        const sandbox = await createZeishApi(config).createSandbox({
          name: options?.name ?? 'Zeish sandbox',
          templateId,
          region: options?.region,
          metadata: options?.metadata,
          ...(ingressOptions.ingress ? { ingress: ingressOptions.ingress } : {}),
        });
        return { sandbox: managedSandbox(config, sandbox), sandboxId: sandbox.id };
      },
      getById: async (config, sandboxId) => {
        try {
          const sandbox = await createZeishApi(config).getSandbox(sandboxId);
          return { sandbox: managedSandbox(config, sandbox), sandboxId };
        } catch (error) {
          if (!(error instanceof ZeishApiError) || error.status !== 404) throw error;
          return null;
        }
      },
      list: async config =>
        (await listAllSandboxes(config)).map(sandbox => ({ sandbox, sandboxId: sandbox.id })),
      destroy: async (config, sandboxId) => {
        await createZeishApi(config).destroySandbox(sandboxId);
      },
      runCommand: async (sandbox, command, options?: RunCommandOptions): Promise<CommandResult> =>
        runSandboxdCommand({ access: await access(sandbox), command, options }),
      getInfo: async sandbox => ({
        id: sandbox.id,
        provider: 'zeish',
        status:
          sandbox.status === 'failed'
            ? 'error'
            : sandbox.status === 'stopped' || sandbox.status === 'paused'
              ? 'stopped'
              : 'running',
        createdAt: new Date(sandbox.createdAt),
      }) as SandboxInfo,
      getUrl: async (sandbox, options) =>
        (await createZeishApi(sandbox.config).createPreviewCode(sandbox.id, { port: options.port }))
          .url,
      filesystem: {
        readFile: async (sandbox, path): Promise<string> =>
          (await fileRequest(sandbox, `/files/download?path=${encodeURIComponent(path)}`)).text(),
        writeFile: async (sandbox, path, content): Promise<void> => {
          await fileRequest(sandbox, `/files/write?path=${encodeURIComponent(path)}`, {
            method: 'PUT',
            body: content,
          });
        },
        mkdir: async (sandbox, path): Promise<void> => {
          await fileRequest(sandbox, `/files/mkdir?path=${encodeURIComponent(path)}`, {
            method: 'POST',
          });
        },
        readdir: async (sandbox, path): Promise<FileEntry[]> => {
          const response = await fileRequest(sandbox, `/files?path=${encodeURIComponent(path)}`);
          const payload = (await response.json()) as ZeishFileList;
          return payload.entries.map(entry => ({
            name: entry.name,
            type: entry.is_dir ? 'directory' : 'file',
            size: entry.size,
            modified: new Date(entry.modified),
          }));
        },
        exists: async (sandbox, path): Promise<boolean> => {
          const response = await fileRequest(sandbox, `/files/stat?path=${encodeURIComponent(path)}`);
          return ((await response.json()) as ZeishFileStat).exists;
        },
        remove: async (sandbox, path): Promise<void> => {
          await fileRequest(sandbox, `/files/remove?path=${encodeURIComponent(path)}`, {
            method: 'POST',
          });
        },
      },
      getInstance: sandbox => sandbox,
    },
    snapshot: {
      create: async (config, sandboxId, options) => {
        const snapshot = await createZeishApi(config).createSnapshot(
          sandboxId,
          options?.name ?? 'snapshot',
        );
        return {
          id: snapshot.id,
          provider: 'zeish',
          createdAt: new Date(snapshot.createdAt),
        };
      },
      list: async () => [],
      delete: async () => {
        throw new Error('Zeish snapshots are sandbox-scoped; delete them through the Zeish REST API.');
      },
    },
  },
});

export { createZeishApi, ZeishApiError } from './public-api.js';
export { createZeishSandboxClient } from './zeish-sandbox-client.js';
export type * from './zeish-sandbox-client.types.js';
export type * from './zeish.types.js';

export {
  CHROME_CDP_PORT,
  PREVIEW_CODE_TTL_AGENT,
  PREVIEW_CODE_TTL_DEFAULT,
  PREVIEW_CODE_TTL_MAX,
  PREVIEW_CODE_TTL_MIN,
  SANDBOX_ATTACH_MAX_ATTEMPTS,
  SANDBOX_READY_POLL_MS,
  SANDBOX_READY_TIMEOUT_MS,
  clampPreviewTtlSeconds,
} from './constants.js';

export {
  fetchPreviewJsonVersion,
  normalizePreviewCode,
  previewAuthHeaders,
  previewOriginFromHandoffUrl,
  resolveCdpEndpoint,
  rewriteCdpWebSocketUrl,
  withPreviewAccessToken,
} from './preview-access.js';
export type { ZeishPreviewCodeRaw } from './preview-access.js';

export {
  isHealthySandboxStatus,
  isRunningSandboxStatus,
  isStartupSandboxStatus,
  isTerminalSandboxStatus,
  normalizeSandboxStatus,
} from './sandbox-status.js';

export {
  createAndStartSandbox,
  destroySandboxBestEffort,
  waitUntilRunning,
} from './sandbox-lifecycle.js';
export type {
  CreateAndStartOptions,
  WaitUntilRunningOptions,
} from './sandbox-lifecycle.js';
