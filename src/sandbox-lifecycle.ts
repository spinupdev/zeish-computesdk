/**
 * Higher-level sandbox lifecycle helpers used by agent platforms (Arin).
 */

import {
  SANDBOX_ATTACH_MAX_ATTEMPTS,
  SANDBOX_READY_POLL_MS,
  SANDBOX_READY_TIMEOUT_MS,
} from "./constants.js";
import type { ZeishPublicApi } from "./zeish.types.js";
import type { ZeishCreateSandboxInput, ZeishSandbox } from "./zeish.types.js";
import {
  isRunningSandboxStatus,
  isTerminalSandboxStatus,
} from "./sandbox-status.js";

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

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let createdId: string | undefined;
    try {
      const name =
        attempt === 1
          ? input.name
          : `${input.name}-r${attempt}`;
      // Keyed per attempt (not just per input.idempotencyKey) so a genuine
      // retry-with-a-fresh-machine after a failed attempt still creates a
      // new one, while a raw transport retry of *this* attempt's HTTP call
      // reuses it instead of creating a duplicate the caller never learns
      // the id of.
      const idempotencyKey = input.idempotencyKey
        ? `${input.idempotencyKey}:attempt-${attempt}`
        : undefined;
      const created = await api.createSandbox({
        ...input,
        name,
        idempotencyKey,
      });
      createdId = created.id;

      try {
        await api.startSandbox(created.id);
      } catch {
        // Start may be implicit or already running.
      }

      return await waitUntilRunning(api, created.id, {
        timeoutMs: options.readyTimeoutMs,
        pollIntervalMs: options.pollIntervalMs,
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
