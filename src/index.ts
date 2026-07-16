import { defineProvider } from '@computesdk/provider';
import type {
  CommandResult,
  CreateSandboxOptions,
  FileEntry,
  RunCommandOptions,
  SandboxInfo,
} from '@computesdk/provider';
import type {
  ZeishAccess,
  ZeishConfig,
  ZeishFileList,
  ZeishFileStat,
  ZeishSandbox,
  ZeishSnapshot,
} from './zeish.types.js';
import { runSandboxdCommand } from './sandboxd-grpc.js';

const defaultBaseUrl = 'https://api.dvito.cloud/api/v1';

function configHeaders(config: ZeishConfig): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-API-Key': config.apiKey,
  };

  if (config.externalIdentity) {
    headers['X-External-Provider'] = 'arin';
    headers['X-External-Organization-Id'] = config.externalIdentity.organizationId;
    headers['X-External-User-Id'] = config.externalIdentity.userId;
  }

  return headers;
}

async function request<T>(config: ZeishConfig, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${config.baseUrl ?? defaultBaseUrl}${path}`, {
    ...init,
    headers: { ...configHeaders(config), ...init?.headers },
  });

  if (!response.ok) throw new Error(`Zeish API ${response.status}: ${await response.text()}`);
  return response.status === 204 ? (undefined as T) : (response.json() as Promise<T>);
}

async function access(sandbox: ZeishSandbox): Promise<ZeishAccess> {
  if (sandbox.access && new Date(sandbox.access.expiresAt).getTime() - Date.now() > 30_000) {
    return sandbox.access;
  }

  sandbox.access = await request<ZeishAccess>(
    sandbox.config,
    `/public/sandboxes/${sandbox.id}/exec-access`
  );
  return sandbox.access;
}

async function fileRequest(sandbox: ZeishSandbox, path: string, init?: RequestInit): Promise<Response> {
  const session = await access(sandbox);
  const response = await fetch(`${session.sandboxUrl}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${session.token}`, ...init?.headers },
  });
  if (!response.ok) throw new Error(`Zeish sandbox filesystem ${response.status}: ${await response.text()}`);
  return response;
}

function managedSandbox(config: ZeishConfig, sandbox: Omit<ZeishSandbox, 'config' | 'access'>): ZeishSandbox {
  return { ...sandbox, config };
}

export const zeish = defineProvider<ZeishSandbox, ZeishConfig>({
  name: 'zeish',
  methods: {
    sandbox: {
      create: async (config, options?: CreateSandboxOptions) => {
        const sandbox = await request<Omit<ZeishSandbox, 'config' | 'access'>>(config, '/public/sandboxes', {
          method: 'POST',
          body: JSON.stringify({
            name: options?.name ?? 'Zeish sandbox',
            templateId: options?.templateId,
            region: options?.region,
          }),
        });
        return { sandbox: managedSandbox(config, sandbox), sandboxId: sandbox.id };
      },
      getById: async (config, sandboxId) => {
        try {
          const sandbox = await request<Omit<ZeishSandbox, 'config' | 'access'>>(config, `/public/sandboxes/${sandboxId}`);
          return { sandbox: managedSandbox(config, sandbox), sandboxId };
        } catch {
          return null;
        }
      },
      list: async config => (await request<Array<Omit<ZeishSandbox, 'config' | 'access'>>>(config, '/public/sandboxes'))
        .map(sandbox => ({ sandbox: managedSandbox(config, sandbox), sandboxId: sandbox.id })),
      destroy: async (config, sandboxId) => {
        await request<void>(config, `/public/sandboxes/${sandboxId}`, { method: 'DELETE' });
      },
      runCommand: async (sandbox, command, options?: RunCommandOptions): Promise<CommandResult> =>
        runSandboxdCommand({ access: await access(sandbox), command, options }),
      getInfo: async sandbox => ({
        id: sandbox.id,
        provider: 'zeish',
        status: sandbox.status === 'error' ? 'error' : sandbox.status === 'stopped' || sandbox.status === 'paused' ? 'stopped' : 'running',
        createdAt: new Date(sandbox.createdAt),
      } as SandboxInfo),
      getUrl: async (sandbox, options) => (await request<{ url: string }>(sandbox.config, `/public/sandboxes/${sandbox.id}/preview-codes`, {
        method: 'POST',
        body: JSON.stringify({ port: options.port }),
      })).url,
      filesystem: {
        readFile: async (sandbox, path): Promise<string> => (await fileRequest(sandbox, `/files/download?path=${encodeURIComponent(path)}`)).text(),
        writeFile: async (sandbox, path, content): Promise<void> => {
          await fileRequest(sandbox, `/files/write?path=${encodeURIComponent(path)}`, { method: 'PUT', body: content });
        },
        mkdir: async (sandbox, path): Promise<void> => {
          await fileRequest(sandbox, `/files/mkdir?path=${encodeURIComponent(path)}`, { method: 'POST' });
        },
        readdir: async (sandbox, path): Promise<FileEntry[]> => {
          const response = await fileRequest(sandbox, `/files?path=${encodeURIComponent(path)}`);
          const payload = await response.json() as ZeishFileList;
          return payload.entries.map(entry => ({
            name: entry.name,
            type: entry.is_dir ? 'directory' : 'file',
            size: entry.size,
            modified: new Date(entry.modified),
          }));
        },
        exists: async (sandbox, path): Promise<boolean> => {
          const response = await fileRequest(sandbox, `/files/stat?path=${encodeURIComponent(path)}`);
          return (await response.json() as ZeishFileStat).exists;
        },
        remove: async (sandbox, path): Promise<void> => {
          await fileRequest(sandbox, `/files/remove?path=${encodeURIComponent(path)}`, { method: 'POST' });
        },
      },
      getInstance: sandbox => sandbox,
    },
    snapshot: {
      create: async (config, sandboxId, options) => {
        const snapshot = await request<ZeishSnapshot>(config, `/public/sandboxes/${sandboxId}/snapshots`, {
          method: 'POST',
          body: JSON.stringify({ displayName: options?.name ?? 'snapshot' }),
        });
        return { id: snapshot.id, provider: 'zeish', createdAt: new Date(snapshot.createdAt) };
      },
      list: async () => [],
      delete: async () => {
        throw new Error('Zeish snapshots are sandbox-scoped; delete them through the Zeish REST API.');
      },
    },
  },
});

export type { ZeishConfig, ZeishSandbox } from './zeish.types.js';
