import { describe, expect, it } from 'vitest';
import {
  assertSandboxTransition,
  canTransitionSandbox,
  isRunningSandboxStatus,
  isStartupSandboxStatus,
  isTerminalSandboxStatus,
} from './sandbox-status';

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

  it('validates lifecycle transitions', () => {
    expect(canTransitionSandbox('pending', 'start')).toBe(true);
    expect(canTransitionSandbox('running', 'pause')).toBe(true);
    expect(canTransitionSandbox('failed', 'start')).toBe(false);
    expect(() => assertSandboxTransition('failed', 'start')).toThrow(
      'Cannot start sandbox from status: failed',
    );
  });
});
