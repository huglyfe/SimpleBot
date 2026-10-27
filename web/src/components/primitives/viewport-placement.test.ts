import { describe, expect, it } from 'vitest';

import { placeFloatingSurface } from './viewport-placement.js';

const viewport = { left: 12, top: 12, right: 308, bottom: 556 };

describe('placeFloatingSurface', () => {
  it('shifts an end-aligned panel fully inside a narrow viewport', () => {
    expect(
      placeFloatingSurface({
        trigger: { left: 128, top: 500, width: 34, height: 34 },
        panel: { width: 286, height: 141 },
        viewport,
        preferredSide: 'above',
        align: 'end',
        gap: 8,
      }),
    ).toMatchObject({ left: 12, side: 'above' });
  });

  it('caps a surface wider than the available visual viewport', () => {
    const result = placeFloatingSurface({
      trigger: { left: 20, top: 400, width: 34, height: 34 },
      panel: { width: 420, height: 200 },
      viewport,
      preferredSide: 'above',
      align: 'start',
      gap: 8,
    });
    expect(result.left).toBe(12);
    expect(result.maxWidth).toBe(296);
  });

  it('flips when the preferred side cannot fit and the other side can', () => {
    expect(
      placeFloatingSurface({
        trigger: { left: 20, top: 40, width: 34, height: 34 },
        panel: { width: 180, height: 200 },
        viewport,
        preferredSide: 'above',
        align: 'start',
        gap: 8,
      }).side,
    ).toBe('below');
  });
});
