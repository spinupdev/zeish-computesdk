import { describe, expect, it } from 'vitest';
import {
  PREVIEW_CODE_TTL_DEFAULT,
  PREVIEW_CODE_TTL_MAX,
  PREVIEW_CODE_TTL_MIN,
  clampPreviewTtlSeconds,
} from './constants';

describe('clampPreviewTtlSeconds', () => {
  it('defaults when undefined', () => {
    expect(clampPreviewTtlSeconds(undefined)).toBe(PREVIEW_CODE_TTL_DEFAULT);
  });

  it('clamps above max', () => {
    expect(clampPreviewTtlSeconds(999_999)).toBe(PREVIEW_CODE_TTL_MAX);
  });

  it('clamps below min', () => {
    expect(clampPreviewTtlSeconds(0)).toBe(PREVIEW_CODE_TTL_MIN);
    expect(clampPreviewTtlSeconds(-5)).toBe(PREVIEW_CODE_TTL_MIN);
  });

  it('passes through valid values', () => {
    expect(clampPreviewTtlSeconds(120)).toBe(120);
    expect(clampPreviewTtlSeconds(PREVIEW_CODE_TTL_MAX)).toBe(PREVIEW_CODE_TTL_MAX);
  });
});
