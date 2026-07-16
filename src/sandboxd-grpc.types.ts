import type { CommandResult, RunCommandOptions } from '@computesdk/provider';
import type { ZeishAccess } from './zeish.types.js';

export interface SandboxdExecRequest {
  cmd: string[];
  timeout_seconds: number;
  env: Record<string, string>;
  working_dir: string;
}

export interface SandboxdExecExit {
  exit_code: number;
  timed_out: boolean;
}

export interface SandboxdExecEvent {
  stdout?: Buffer;
  stderr?: Buffer;
  exit?: SandboxdExecExit;
}

export interface SandboxdExecution {
  id: string;
  status: string;
  stdout: Buffer;
  stderr: Buffer;
  exit_code: number;
  timed_out: boolean;
}

export interface RunSandboxdCommandInput {
  access: ZeishAccess;
  command: string;
  options?: RunCommandOptions;
}

export interface StreamCallbackOptions {
  onStdout?: (data: string) => void;
  onStderr?: (data: string) => void;
}

export type SandboxdCommandResult = CommandResult;
