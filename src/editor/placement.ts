import type { Rect } from './model';

/**
 * Geometry of an image being placed on the canvas: move, resize and the
 * magnetic snapping to the canvas borders, corners and center. All values are
 * in canvas pixels; callers convert screen distances (and the snap threshold)
 * with the current zoom. These functions are pure so they can be tested
 * without a DOM.
 */

export type PlacementHandle = 'n' | 's' | 'e' | 'w' | 'nw' | 'ne' | 'sw' | 'se';

/** The image can never be made smaller than this, so it cannot be lost under its own handles. */
export const MIN_PLACEMENT_SIZE = 4;

/** Snap distance in screen pixels. Divide by the zoom scale to get canvas pixels. */
export const SNAP_THRESHOLD_SCREEN_PX = 10;

interface Snap {
  /** Signed correction to add to the position. */
  delta: number;
  distance: number;
}

/** Smallest correction that brings `value` onto one of `targets`, or `null` when none is close enough. */
function nearestSnap(value: number, targets: readonly number[], threshold: number): Snap | null {
  let best: Snap | null = null;
  for (const target of targets) {
    const distance = Math.abs(target - value);
    if (distance <= threshold && (best === null || distance < best.distance)) {
      best = { delta: target - value, distance };
    }
  }
  return best;
}

/** Snaps the start edge, end edge or center of a span (`position`..`position + size`) to the canvas extent. */
function snapSpan(position: number, size: number, extent: number, threshold: number): number {
  const candidates = [
    nearestSnap(position, [0], threshold),
    nearestSnap(position + size, [extent], threshold),
    nearestSnap(position + size / 2, [extent / 2], threshold)
  ].filter((snap): snap is Snap => snap !== null);
  if (candidates.length === 0) {
    return position;
  }
  const best = candidates.reduce((closest, snap) => (snap.distance < closest.distance ? snap : closest));
  return position + best.delta;
}

function round(rect: { x: number; y: number; width: number; height: number }): Rect {
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.max(1, Math.round(rect.width)),
    height: Math.max(1, Math.round(rect.height))
  };
}

/** Initial placement: the whole image if it fits, otherwise scaled down to fit, centered on `center`. */
export function fitPlacementRect(
  canvasWidth: number,
  canvasHeight: number,
  imageWidth: number,
  imageHeight: number,
  center: { x: number; y: number } = { x: canvasWidth / 2, y: canvasHeight / 2 }
): Rect {
  const scale = Math.min(1, canvasWidth / imageWidth, canvasHeight / imageHeight);
  const width = Math.max(1, Math.round(imageWidth * scale));
  const height = Math.max(1, Math.round(imageHeight * scale));
  return {
    x: Math.round(Math.min(Math.max(center.x - width / 2, 0), Math.max(0, canvasWidth - width))),
    y: Math.round(Math.min(Math.max(center.y - height / 2, 0), Math.max(0, canvasHeight - height))),
    width,
    height
  };
}

/**
 * Moves the image by `(dx, dy)`. Its edges snap to the canvas borders (so
 * dragging it into a corner snaps both axes) and its center to the canvas center.
 * The image may extend past the canvas; the part outside is simply clipped.
 */
export function movePlacement(
  start: Rect,
  dx: number,
  dy: number,
  canvasWidth: number,
  canvasHeight: number,
  threshold: number
): Rect {
  return round({
    x: snapSpan(start.x + dx, start.width, canvasWidth, threshold),
    y: snapSpan(start.y + dy, start.height, canvasHeight, threshold),
    width: start.width,
    height: start.height
  });
}

/**
 * Resizes the image from `handle`. Side handles stretch freely. Corner handles
 * keep the aspect ratio unless `keepAspect` is `false`. The edges being dragged
 * snap to the canvas borders; the opposite side stays fixed.
 */
export function resizePlacement(
  start: Rect,
  handle: PlacementHandle,
  dx: number,
  dy: number,
  canvasWidth: number,
  canvasHeight: number,
  threshold: number,
  keepAspect = true
): Rect {
  const movesWest = handle.includes('w');
  const movesEast = handle.includes('e');
  const movesNorth = handle.includes('n');
  const movesSouth = handle.includes('s');
  const left = start.x;
  const right = start.x + start.width;
  const top = start.y;
  const bottom = start.y + start.height;

  if (handle.length === 2 && keepAspect) {
    const minScale = MIN_PLACEMENT_SIZE / Math.min(start.width, start.height);
    const widthScale = (movesEast ? start.width + dx : start.width - dx) / start.width;
    const heightScale = (movesSouth ? start.height + dy : start.height - dy) / start.height;
    let scale = Math.abs(widthScale - 1) >= Math.abs(heightScale - 1) ? widthScale : heightScale;

    // Where the dragged corner lands for a given scale, so it can snap to a canvas border.
    const cornerX = (value: number) => (movesEast ? left + start.width * value : right - start.width * value);
    const cornerY = (value: number) => (movesSouth ? top + start.height * value : bottom - start.height * value);
    const x = cornerX(scale);
    const y = cornerY(scale);
    const snapX = nearestSnap(x, [0, canvasWidth], threshold);
    const snapY = nearestSnap(y, [0, canvasHeight], threshold);
    if (snapX !== null && (snapY === null || snapX.distance <= snapY.distance)) {
      const snapped = x + snapX.delta;
      scale = (movesEast ? snapped - left : right - snapped) / start.width;
    } else if (snapY !== null) {
      const snapped = y + snapY.delta;
      scale = (movesSouth ? snapped - top : bottom - snapped) / start.height;
    }

    scale = Math.max(scale, minScale);
    const width = start.width * scale;
    const height = start.height * scale;
    return round({ x: movesEast ? left : right - width, y: movesSouth ? top : bottom - height, width, height });
  }

  const snapEdge = (value: number, extent: number) => value + (nearestSnap(value, [0, extent], threshold)?.delta ?? 0);
  let nextLeft = left;
  let nextRight = right;
  let nextTop = top;
  let nextBottom = bottom;
  if (movesWest) {
    nextLeft = Math.min(snapEdge(left + dx, canvasWidth), right - MIN_PLACEMENT_SIZE);
  }
  if (movesEast) {
    nextRight = Math.max(snapEdge(right + dx, canvasWidth), left + MIN_PLACEMENT_SIZE);
  }
  if (movesNorth) {
    nextTop = Math.min(snapEdge(top + dy, canvasHeight), bottom - MIN_PLACEMENT_SIZE);
  }
  if (movesSouth) {
    nextBottom = Math.max(snapEdge(bottom + dy, canvasHeight), top + MIN_PLACEMENT_SIZE);
  }
  return round({ x: nextLeft, y: nextTop, width: nextRight - nextLeft, height: nextBottom - nextTop });
}
