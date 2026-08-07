import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type {
  RunSandboxdCommandInput,
  SandboxdCommandResult,
  SandboxdExecution,
  SandboxdExecEvent,
  SandboxdExecRequest,
  StreamCallbackOptions,
} from './sandboxd-grpc.types.js';

type SandboxdClient = grpc.Client & {
  execStream(
    request: SandboxdExecRequest,
    metadata: grpc.Metadata
  ): grpc.ClientReadableStream<SandboxdExecEvent>;
  startExecution(
    request: SandboxdExecRequest,
    metadata: grpc.Metadata,
    callback: (error: grpc.ServiceError | null, response: SandboxdExecution) => void
  ): void;
};

let SandboxdServiceCtor: grpc.ServiceClientConstructor | undefined;

/** Resolve sandboxd.proto relative to this module (dist/) or package root. */
function resolveProtoPath(): string {
  const here = fileURLToPath(import.meta.url);
  const candidates = [
    join(dirname(here), '..', 'proto', 'sandboxd.proto'),
    join(dirname(here), 'proto', 'sandboxd.proto'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[0]!;
}

function getSandboxdService(): grpc.ServiceClientConstructor {
  if (SandboxdServiceCtor) return SandboxdServiceCtor;
  const definition = protoLoader.loadSync(resolveProtoPath(), {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  });
  const packageDefinition = grpc.loadPackageDefinition(definition) as unknown as {
    sandboxd: { v1: { SandboxdService: grpc.ServiceClientConstructor } };
  };
  SandboxdServiceCtor = packageDefinition.sandboxd.v1.SandboxdService;
  return SandboxdServiceCtor;
}

function rpcAddress(url: string): string {
  return new URL(url).host;
}

export async function runSandboxdCommand(
  input: RunSandboxdCommandInput
): Promise<SandboxdCommandResult> {
  const startedAt = Date.now();
  const SandboxdService = getSandboxdService();
  const client = new SandboxdService(
    rpcAddress(input.access.sandboxRpcUrl),
    grpc.credentials.createSsl()
  ) as unknown as SandboxdClient;
  const metadata = new grpc.Metadata();
  metadata.set('authorization', `Bearer ${input.access.token}`);
  const request: SandboxdExecRequest = {
    cmd: ['sh', '-lc', input.command],
    timeout_seconds: Math.ceil((input.options?.timeout ?? 0) / 1_000),
    env: input.options?.env ?? {},
    working_dir: input.options?.cwd ?? '',
  };
  const callbacks = input.options as StreamCallbackOptions | undefined;

  if (input.options?.background) {
    return new Promise((resolve, reject) => {
      client.startExecution(request, metadata, (error, _execution) => {
        client.close();
        if (error) {
          reject(error);
          return;
        }
        resolve({ stdout: '', stderr: '', exitCode: 0, durationMs: Date.now() - startedAt });
      });
    });
  }

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const stdoutDecoder = new StringDecoder('utf8');
    const stderrDecoder = new StringDecoder('utf8');
    const appendStdout = (chunk: string) => {
      stdout += chunk;
      callbacks?.onStdout?.(chunk);
    };
    const appendStderr = (chunk: string) => {
      stderr += chunk;
      callbacks?.onStderr?.(chunk);
    };
    const flushDecoders = () => {
      const stdoutTail = stdoutDecoder.end();
      if (stdoutTail) appendStdout(stdoutTail);
      const stderrTail = stderrDecoder.end();
      if (stderrTail) appendStderr(stderrTail);
    };
    const stream = client.execStream(request, metadata);
    stream.on('data', (event: SandboxdExecEvent) => {
      if (event.stdout) {
        const chunk = stdoutDecoder.write(event.stdout);
        if (chunk) appendStdout(chunk);
      }
      if (event.stderr) {
        const chunk = stderrDecoder.write(event.stderr);
        if (chunk) appendStderr(chunk);
      }
      if (event.exit) {
        flushDecoders();
        settled = true;
        resolve({
          stdout,
          stderr,
          exitCode: event.exit.exit_code,
          durationMs: Date.now() - startedAt,
        });
      }
    });
    stream.on('error', error => {
      client.close();
      if (!settled) reject(error);
    });
    stream.on('end', () => {
      if (!settled) reject(new Error('sandboxd ExecStream ended without an exit event'));
      client.close();
    });
  });
}
