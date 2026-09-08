import { describe, expect, it } from 'vitest';
import { getPanelBounds } from './window-position';

describe('desktop positioning in device-independent pixels', () => {
  it('clears the macOS menu bar and Dock using the available work area', () => {
    expect(getPanelBounds({ x: 0, y: 25, width: 1440, height: 815 })).toEqual({
      x: 1004,
      y: 244,
      width: 420,
      height: 580,
    });
  });

  it('anchors to a secondary monitor with a negative origin', () => {
    expect(getPanelBounds({ x: -1920, y: -100, width: 1920, height: 1040 })).toEqual({
      x: -436,
      y: 344,
      width: 420,
      height: 580,
    });
  });

  it('fits within a small display without placing controls outside the work area', () => {
    expect(getPanelBounds({ x: 300, y: 40, width: 360, height: 480 })).toEqual({
      x: 316,
      y: 56,
      width: 328,
      height: 448,
    });
  });
});
