import { describe, expect, it } from 'vitest';
import { rangeProgress } from './RangeControl.js';

describe('RangeControl', () => {
  it('clamps its visual progress to the configured range', () => {
    expect(rangeProgress(50, 0, 100)).toBe(50);
    expect(rangeProgress(-1, 0, 100)).toBe(0);
    expect(rangeProgress(101, 0, 100)).toBe(100);
    expect(rangeProgress(10, 10, 10)).toBe(0);
  });
});
