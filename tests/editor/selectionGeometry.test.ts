import { describe, expect, it } from 'vitest';
import type { Rect } from '@editor/model';
import { hitTest, moveRect, rectFromPoints, resizeRect } from '@editor/selection/geometry';
import { resample } from '@editor/selection/resample';

const W = 16;
const H = 16;
const START: Rect = { x: 4, y: 4, width: 4, height: 4 };

describe('selection rectangle', () => {
  it('is normalized whatever the direction of the drag', () => {
    const expected = { x: 2, y: 3, width: 5, height: 4 };
    expect(rectFromPoints({ x: 2, y: 3 }, { x: 7, y: 7 }, W, H)).toEqual(expected);
    expect(rectFromPoints({ x: 7, y: 7 }, { x: 2, y: 3 }, W, H)).toEqual(expected);
    expect(rectFromPoints({ x: 7, y: 3 }, { x: 2, y: 7 }, W, H)).toEqual(expected);
    expect(rectFromPoints({ x: 2, y: 7 }, { x: 7, y: 3 }, W, H)).toEqual(expected);
  });

  it('is clipped to the canvas', () => {
    expect(rectFromPoints({ x: -5, y: -5 }, { x: 4, y: 4 }, W, H)).toEqual({ x: 0, y: 0, width: 4, height: 4 });
    expect(rectFromPoints({ x: 10, y: 10 }, { x: 40, y: 40 }, W, H)).toEqual({ x: 10, y: 10, width: 6, height: 6 });
  });

  it('is discarded when it covers no pixel', () => {
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 5, y: 5 }, W, H)).toBeNull();
    expect(rectFromPoints({ x: 5, y: 5 }, { x: 9, y: 5 }, W, H)).toBeNull();
    expect(rectFromPoints({ x: -4, y: -4 }, { x: -1, y: -1 }, W, H)).toBeNull();
  });
});

describe('selection hit testing', () => {
  const rect: Rect = { x: 2, y: 2, width: 12, height: 12 };

  it('prefers a handle over the inside', () => {
    expect(hitTest(rect, { x: 2.5, y: 2.5 }, 1)).toEqual({ kind: 'handle', handle: 'nw' });
    expect(hitTest(rect, { x: 8, y: 14 }, 1)).toEqual({ kind: 'handle', handle: 's' });
    expect(hitTest(rect, { x: 14.5, y: 8 }, 1)).toEqual({ kind: 'handle', handle: 'e' });
  });

  it('reaches handles slightly outside the rectangle, by the tolerance', () => {
    expect(hitTest(rect, { x: 15, y: 15 }, 1)).toEqual({ kind: 'handle', handle: 'se' });
    expect(hitTest(rect, { x: 16.5, y: 16.5 }, 1)).toEqual({ kind: 'outside' });
  });

  it('tells the inside from the outside', () => {
    expect(hitTest(rect, { x: 8, y: 8 }, 1)).toEqual({ kind: 'inside' });
    expect(hitTest(rect, { x: 0, y: 0 }, 1)).toEqual({ kind: 'outside' });
  });

  it('keeps the middle of a small rectangle draggable, whatever the tolerance', () => {
    expect(hitTest({ x: 4, y: 4, width: 4, height: 4 }, { x: 6, y: 6 }, 8)).toEqual({ kind: 'inside' });
  });
});

describe('moving the selection', () => {
  it('moves by whole pixels', () => {
    expect(moveRect(START, 3.4, -2.6, W, H)).toEqual({ x: 7, y: 1, width: 4, height: 4 });
  });

  it('keeps at least one pixel inside the canvas', () => {
    expect(moveRect(START, -100, -100, W, H)).toMatchObject({ x: -3, y: -3 });
    expect(moveRect(START, 100, 100, W, H)).toMatchObject({ x: 15, y: 15 });
  });
});

describe('resizing the selection', () => {
  it('moves only the dragged edges, in every direction', () => {
    expect(resizeRect(START, 'e', 2, 9, false, W, H)).toEqual({ x: 4, y: 4, width: 6, height: 4 });
    expect(resizeRect(START, 'w', -2, 9, false, W, H)).toEqual({ x: 2, y: 4, width: 6, height: 4 });
    expect(resizeRect(START, 'n', 9, -2, false, W, H)).toEqual({ x: 4, y: 2, width: 4, height: 6 });
    expect(resizeRect(START, 's', 9, 2, false, W, H)).toEqual({ x: 4, y: 4, width: 4, height: 6 });
    expect(resizeRect(START, 'se', 3, 1, false, W, H)).toEqual({ x: 4, y: 4, width: 7, height: 5 });
    expect(resizeRect(START, 'nw', -1, -2, false, W, H)).toEqual({ x: 3, y: 2, width: 5, height: 6 });
    expect(resizeRect(START, 'ne', 2, -1, false, W, H)).toEqual({ x: 4, y: 3, width: 6, height: 5 });
    expect(resizeRect(START, 'sw', -2, 2, false, W, H)).toEqual({ x: 2, y: 4, width: 6, height: 6 });
  });

  it('stops one pixel short of the opposite edge instead of flipping', () => {
    expect(resizeRect(START, 'e', -50, 0, false, W, H)).toEqual({ x: 4, y: 4, width: 1, height: 4 });
    expect(resizeRect(START, 'w', 50, 0, false, W, H)).toEqual({ x: 7, y: 4, width: 1, height: 4 });
    expect(resizeRect(START, 'se', -50, -50, false, W, H)).toEqual({ x: 4, y: 4, width: 1, height: 1 });
    expect(resizeRect(START, 'nw', 50, 50, false, W, H)).toEqual({ x: 7, y: 7, width: 1, height: 1 });
  });

  it('keeps the dragged edges inside the canvas', () => {
    expect(resizeRect(START, 'se', 100, 100, false, W, H)).toEqual({ x: 4, y: 4, width: 12, height: 12 });
    expect(resizeRect(START, 'nw', -100, -100, false, W, H)).toEqual({ x: 0, y: 0, width: 8, height: 8 });
  });

  it('keeps the proportions from a corner, anchored at the opposite corner', () => {
    const start: Rect = { x: 2, y: 2, width: 4, height: 2 };
    expect(resizeRect(start, 'se', 4, 0, true, W, H)).toEqual({ x: 2, y: 2, width: 8, height: 4 });
    expect(resizeRect(start, 'nw', -2, 0, true, W, H)).toEqual({ x: 0, y: 1, width: 6, height: 3 });
  });

  it('follows the axis that moved the most on a corner', () => {
    const start: Rect = { x: 2, y: 2, width: 4, height: 2 };
    expect(resizeRect(start, 'se', 0, 2, true, W, H)).toEqual({ x: 2, y: 2, width: 8, height: 4 });
  });

  it('scales the other axis around the center from a side', () => {
    expect(resizeRect(START, 'e', 4, 0, true, W, H)).toEqual({ x: 4, y: 2, width: 8, height: 8 });
    expect(resizeRect(START, 's', 0, 4, true, W, H)).toEqual({ x: 2, y: 4, width: 8, height: 8 });
  });

  it('never collapses below one pixel when keeping the proportions', () => {
    const rect = resizeRect(START, 'se', -50, -50, true, W, H);
    expect(rect.width).toBeGreaterThanOrEqual(1);
    expect(rect.height).toBeGreaterThanOrEqual(1);
  });
});

describe('resampling', () => {
  const source = new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 255, 255]);

  it('returns the pixels as they are when the size does not change', () => {
    expect(resample(source, 2, 1, 2, 1, 'smooth')).toBe(source);
    expect(resample(source, 2, 1, 2, 1, 'nearest')).toBe(source);
  });

  it('keeps hard pixels with nearest neighbor', () => {
    const result = resample(source, 2, 1, 4, 1, 'nearest');
    expect(Array.from(result)).toEqual([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 255, 255]);
  });

  it('blends neighbors with smooth', () => {
    const result = resample(source, 2, 1, 4, 1, 'smooth');
    // The two middle samples are a mix of red and blue; the ends keep their color.
    expect(Array.from(result.subarray(0, 4))).toEqual([255, 0, 0, 255]);
    expect(Array.from(result.subarray(12, 16))).toEqual([0, 0, 255, 255]);
    expect(result[4]).toBeGreaterThan(100);
    expect(result[6]).toBeGreaterThan(0);
  });

  it('does not tint opaque pixels with the color of transparent neighbors', () => {
    const edge = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 0]);
    const result = resample(edge, 2, 1, 4, 1, 'smooth');
    for (let pixel = 0; pixel < 4; pixel += 1) {
      if (result[pixel * 4 + 3] !== 0) {
        expect(Array.from(result.subarray(pixel * 4, pixel * 4 + 3))).toEqual([255, 0, 0]);
      }
    }
    expect(result[7]).toBeLessThan(255);
  });

  it('is deterministic', () => {
    expect(resample(source, 2, 1, 5, 3, 'smooth')).toEqual(resample(source, 2, 1, 5, 3, 'smooth'));
  });
});
