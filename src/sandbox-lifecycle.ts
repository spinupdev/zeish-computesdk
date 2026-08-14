/**
 * Higher-level sandbox lifecycle helpers used by agent platforms (Arin).
 */

import {
  SANDBOX_ATTACH_MAX_ATTEMPTS,
  SANDBOX_READY_POLL_MS,
  SANDBOX_READY_TIMEOUT_MS,
} from "./constants";
import type { ZeishPublicApi } from "./zeish.types";
import type { ZeishCreateSandboxInput, ZeishSandbox } from "./zeish.types";
import {
  assertSandboxTransition,
  isRunningSandboxStatus,
  isTerminalSandboxStatus,
} from "./sandbox-status";

export interface WaitUntilRunningOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

/**
 * Poll getSandbox until status is running, or throw on terminal failure / timeout.
 */
export async function waitUntilRunning(
  api: ZeishPublicApi,
  sandboxId: string,
  options: WaitUntilRunningOptions = {},
): Promise<ZeishSandbox> {
  const timeoutMs = options.timeoutMs ?? SANDBOX_READY_TIMEOUT_MS;
  const pollMs = options.pollIntervalMs ?? SANDBOX_READY_POLL_MS;
  const deadline = Date.now() + timeoutMs;
  let lastStatus = "unknown";

  while (Date.now() < deadline) {
    const sandbox = await api.getSandbox(sandboxId);
    lastStatus = sandbox.status;
    if (isRunningSandboxStatus(sandbox.status)) return sandbox;
    if (isTerminalSandboxStatus(sandbox.status)) {
      throw new Error(
        `Zeish sandbox ${sandboxId} entered terminal status: ${sandbox.status}` +
          (sandbox.lastError ? ` (${sandbox.lastError})` : ""),
      );
    }
    await sleep(pollMs);
  }

  throw new Error(
    `Zeish sandbox ${sandboxId} not running within ${timeoutMs}ms (last status: ${lastStatus})`,
  );
}

/**
 * Best-effort destroy (never throws).
 */
export async function destroySandboxBestEffort(
  api: ZeishPublicApi,
  sandboxId: string,
): Promise<boolean> {
  try {
    await api.destroySandbox(sandboxId);
    return true;
  } catch {
    return false;
  }
}

export interface CreateAndStartOptions {
  maxAttempts?: number;
  readyTimeoutMs?: number;
  pollIntervalMs?: number;
  /** Called after each failed attempt (before destroy). */
  onAttemptFailed?: (info: {
    attempt: number;
    sandboxId?: string;
    error: string;
  }) => void;
}

/**
 * Create → start → waitUntilRunning. On failure destroy the VM and retry
 * with a fresh sandbox (fixes flaky regiond / failed desktop boots).
 */
export async function createAndStartSandbox(
  api: ZeishPublicApi,
  input: ZeishCreateSandboxInput,
  options: CreateAndStartOptions = {},
): Promise<ZeishSandbox> {
  const maxAttempts = Math.max(
    1,
    options.maxAttempts ?? SANDBOX_ATTACH_MAX_ATTEMPTS,
  );
  const errors: string[] = [];
  let createAttempt = 1;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let createdId: string | undefined;
    try {
      const name =
        attempt === 1
          ? input.name
          : `${input.name}-r${attempt}`;
      // Keep the key stable until create returns a sandbox. If the transport
      // fails after the server accepted the request, the next call must
      // recover that same sandbox instead of creating an unknown duplicate.
      const idempotencyKey = input.idempotencyKey
        ? `${input.idempotencyKey}:attempt-${createAttempt}`
        : undefined;
      const created = await api.createSandbox({
        ...input,
        name,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });
      createdId = created.id;
      // A response established the sandbox identity, so a later readiness
      // failure is an intentional replacement and may use a fresh key.
      createAttempt++;

      // createSandbox already sets desiredStatus "running" and boots the
      // machine on its own -- an explicit startSandbox() call landing while
      // the machine is still mid-create races Edge's state machine and can
      // kill the runtime outright (observed: instant "failed" with an empty
      // "runtime terminal state: " lastError, reproduced by curl with no
      // other client in the loop). Only call start for the case it's
      // actually for: a sandbox that came back not already on its way up.
      if (created.desiredStatus !== "running" && !isRunningSandboxStatus(created.status)) {
        try {
          assertSandboxTransition(created.status, 'start');
          await api.startSandbox(created.id);
        } catch {
          // Start may be implicit or already running.
        }
      }

      return await waitUntilRunning(api, created.id, {
        ...(options.readyTimeoutMs !== undefined ? { timeoutMs: options.readyTimeoutMs } : {}),
        ...(options.pollIntervalMs !== undefined ? { pollIntervalMs: options.pollIntervalMs } : {}),
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      errors.push(`attempt ${attempt}: ${message}`);
      options.onAttemptFailed?.({
        attempt,
        ...(createdId ? { sandboxId: createdId } : {}),
        error: message,
      });
      if (createdId) {
        await destroySandboxBestEffort(api, createdId);
      }
    }
  }

  throw new Error(
    `Zeish createAndStartSandbox failed after ${maxAttempts} attempt(s): ${errors.join(" | ")}`,
  );
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
