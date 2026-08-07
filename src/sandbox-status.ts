/**
 * Sandbox status helpers aligned with Edge ProductState + observed live values.
 */

import type { ZeishSandboxStatus } from "./zeish.types.js";

/** Align with Edge ProductState (+ a few legacy aliases). */
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
