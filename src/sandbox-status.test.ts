import { describe, expect, it } from 'vitest';
import {
  isRunningSandboxStatus,
  isStartupSandboxStatus,
  isTerminalSandboxStatus,
} from './sandbox-status.js';

describe('sandbox status helpers', () => {
  it('treats failed as terminal', () => {
    expect(isTerminalSandboxStatus('failed')).toBe(true);
    expect(isTerminalSandboxStatus('error')).toBe(true);
    expect(isTerminalSandboxStatus('running')).toBe(false);
  });

  it('recognizes startup states', () => {
    expect(isStartupSandboxStatus('pending')).toBe(true);
    expect(isStartupSandboxStatus('creating')).toBe(true);
    expect(isStartupSandboxStatus('running')).toBe(false);
  });

  it('recognizes running', () => {
    expect(isRunningSandboxStatus('running')).toBe(true);
    expect(isRunningSandboxStatus('Running')).toBe(true);
  });
});
