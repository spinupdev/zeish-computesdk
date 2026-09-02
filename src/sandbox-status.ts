/**
 * Sandbox status helpers aligned with the control plane's ProductState + observed live values.
 */

import type {
  ZeishSandboxLifecycleAction,
  ZeishSandboxStatus,
} from "./zeish.types";

/** Align with the control plane's ProductState (+ a few legacy aliases). */
const TERMINAL_BAD = new Set([
  "failed",
  "error",
  "destroyed",
  "deleted",
  "deleting",
  "destroying",
  "launch_failed",
]);

const STARTUP = new Set([
  "initialized",
  "creating",
  "pending",
  "starting",
  "provisioning",
  "resuming",
]);

const ALLOWED_TRANSITIONS: Readonly<
  Record<ZeishSandboxLifecycleAction, ReadonlySet<string>>
> = {
  start: new Set(['initialized', 'pending', 'stopped', 'paused']),
  pause: new Set(['running']),
  resume: new Set(['paused', 'stopped']),
  stop: new Set(['running', 'paused', 'resuming']),
  kill: new Set(['running', 'pausing', 'resuming', 'stopping']),
  destroy: new Set([
    'initialized',
    'pending',
    'running',
    'paused',
    'stopped',
    'failed',
  ]),
};

export function normalizeSandboxStatus(status: string): string {
  return status.trim().toLowerCase();
}

/** Sandbox will never become usable without recreate. */
export function isTerminalSandboxStatus(
  status: ZeishSandboxStatus | string,
): boolean {
  return TERMINAL_BAD.has(normalizeSandboxStatus(String(status)));
}

/** Actively running and ready for exec / preview. */
export function isRunningSandboxStatus(
  status: ZeishSandboxStatus | string,
): boolean {
  return normalizeSandboxStatus(String(status)) === "running";
}

/** Still booting — keep polling. */
export function isStartupSandboxStatus(
  status: ZeishSandboxStatus | string,
): boolean {
  return STARTUP.has(normalizeSandboxStatus(String(status)));
}

/** Safe to reuse from a warm pool (only running). */
export function isHealthySandboxStatus(
  status: ZeishSandboxStatus | string,
): boolean {
  return isRunningSandboxStatus(status);
}

/** Returns whether the control plane should accept a requested lifecycle transition. */
export function canTransitionSandbox(
  status: ZeishSandboxStatus | string,
  action: ZeishSandboxLifecycleAction,
): boolean {
  return ALLOWED_TRANSITIONS[action].has(normalizeSandboxStatus(String(status)));
}

/** Fail early with a domain-specific error instead of making an invalid call. */
export function assertSandboxTransition(
  status: ZeishSandboxStatus | string,
  action: ZeishSandboxLifecycleAction,
): void {
  if (!canTransitionSandbox(status, action)) {
    throw new Error(`Cannot ${action} sandbox from status: ${status}`);
  }
}
