import { fileURLToPath } from 'node:url';
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';
import type {
  RunSandboxdCommandInput,
  SandboxdCommandResult,
  SandboxdExecEvent,
  SandboxdExecRequest,
  StreamCallbackOptions,
} from './sandboxd-grpc.types.js';

const protoPath = fileURLToPath(new URL('../proto/sandboxd.proto', import.meta.url));
const definition = protoLoader.loadSync(protoPath, {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true,
});
const packageDefinition = grpc.loadPackageDefinition(definition) as unknown as {
  sandboxd: { v1: { SandboxdService: grpc.ServiceClientConstructor } };
};
const SandboxdService = packageDefinition.sandboxd.v1.SandboxdService;

function rpcAddress(url: string): string {
  return new URL(url).host;
}

export async function runSandboxdCommand(
  input: RunSandboxdCommandInput
): Promise<SandboxdCommandResult> {
  const startedAt = Date.now();
  const client = new SandboxdService(
    rpcAddress(input.access.sandboxRpcUrl),
    grpc.credentials.createSsl()
  ) as unknown as grpc.Client & {
    execStream(
      request: SandboxdExecRequest,
      metadata: grpc.Metadata
    ): grpc.ClientReadableStream<SandboxdExecEvent>;
  };
  const metadata = new grpc.Metadata();
  metadata.set('authorization', `Bearer ${input.access.token}`);
  const request: SandboxdExecRequest = {
    cmd: ['sh', '-lc', input.command],
    timeout_seconds: Math.ceil((input.options?.timeout ?? 0) / 1_000),
    env: input.options?.env ?? {},
    working_dir: input.options?.cwd ?? '',
  };
  const callbacks = input.options as StreamCallbackOptions | undefined;

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;
    const stream = client.execStream(request, metadata);
    stream.on('data', (event: SandboxdExecEvent) => {
      if (event.stdout) {
        const chunk = event.stdout.toString();
        stdout += chunk;
        callbacks?.onStdout?.(chunk);
      }
      if (event.stderr) {
        const chunk = event.stderr.toString();
        stderr += chunk;
        callbacks?.onStderr?.(chunk);
      }
      if (event.exit) {
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
      if (!settled) reject(error);
    });
    stream.on('end', () => {
      if (!settled) reject(new Error('sandboxd ExecStream ended without an exit event'));
      client.close();
    });
  });
}
