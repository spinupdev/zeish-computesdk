import { describe, expect, it } from 'vitest';
import { serializeSandboxAction } from './sandbox-actions';

describe('sandbox action commands', () => {
  it('serializes camelCase scroll commands to the sandboxd wire shape', () => {
    expect(serializeSandboxAction({
      type: 'scroll', x: 10, y: 20, deltaX: 2, deltaY: -3,
    })).toEqual({
      type: 'scroll', x: 10, y: 20, delta_x: 2, delta_y: -3,
    });
  });
});
