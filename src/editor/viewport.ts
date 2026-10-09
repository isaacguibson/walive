import { MAX_ZOOM, MIN_ZOOM } from './constants';
import type { Point } from './model';
import { clampZoom } from './validation';

export interface ViewRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Converts a screen position to logical canvas pixels. `rect` is the on-screen
 * rectangle of the canvas element, so this is correct at any zoom level.
 * Returns `null` when the canvas has no visible size.
 */
export function screenToCanvas(
  clientX: number,
  clientY: number,
  rect: ViewRect,
  canvasWidth: number,
  canvasHeight: number
): Point | null {
  if (!(rect.width > 0) || !(rect.height > 0)) {
    return null;
  }
  return {
    x: ((clientX - rect.left) / rect.width) * canvasWidth,
    y: ((clientY - rect.top) / rect.height) * canvasHeight
  };
}

/** Zoom after one mouse-wheel event: scrolling up (negative `deltaY`) zooms in, down zooms out. */
export function zoomFromWheel(zoom: number, deltaY: number): number {
  if (deltaY === 0) {
    return zoom;
  }
  const factor = Math.exp(Math.min(500, Math.max(-500, -deltaY)) * 0.002);
  let next = clampZoom(Math.round(zoom * factor));
  if (next === zoom) {
    // Always make progress, even for tiny wheel deltas or at the limits.
    next = clampZoom(zoom + (deltaY < 0 ? 1 : -1));
  }
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
}

/** Zoom (percent, never above 100) at which the whole canvas fits the viewport. */
export function computeFitZoom(
  viewportWidth: number,
  viewportHeight: number,
  canvasWidth: number,
  canvasHeight: number,
  padding = 48
): number {
  const availableWidth = viewportWidth - padding;
  const availableHeight = viewportHeight - padding;
  if (!(availableWidth > 0) || !(availableHeight > 0)) {
    return 100;
  }
  const scale = Math.min(availableWidth / canvasWidth, availableHeight / canvasHeight);
  return clampZoom(Math.min(100, Math.floor(scale * 100)));
}
