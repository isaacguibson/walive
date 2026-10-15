import { rotatePoint } from '../angles';
import type { Point, Rect } from '../model';
import { RESIZE_HANDLES, type PlacementHandle } from '../placement';

/**
 * Geometry of the rectangular selection: creating, hit testing, moving and
 * resizing. Everything is in canvas pixels and pure, so it is tested without a
 * DOM. Rectangles always have whole-pixel coordinates and at least one pixel of
 * width and height.
 *
 * Crossing the opposite side while resizing is not allowed: the dragged edge
 * stops one pixel short of it, so the selection never flips or collapses.
 */

export type SelectionHit = { kind: 'handle'; handle: PlacementHandle } | { kind: 'rotate' } | { kind: 'inside' } | { kind: 'outside' };

const HANDLE_ANCHORS: Record<PlacementHandle, readonly [number, number]> = {
  nw: [0, 0],
  n: [0.5, 0],
  ne: [1, 0],
  e: [1, 0.5],
  se: [1, 1],
  s: [0.5, 1],
  sw: [0, 1],
  w: [0, 0.5]
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * The rectangle between two pointer positions, in any direction, snapped to the pixel grid and
 * clipped to the canvas. `null` when it covers no pixel (for instance a click without a drag).
 */
export function rectFromPoints(a: Point, b: Point, canvasWidth: number, canvasHeight: number): Rect | null {
  const left = clamp(Math.round(Math.min(a.x, b.x)), 0, canvasWidth);
  const right = clamp(Math.round(Math.max(a.x, b.x)), 0, canvasWidth);
  const top = clamp(Math.round(Math.min(a.y, b.y)), 0, canvasHeight);
  const bottom = clamp(Math.round(Math.max(a.y, b.y)), 0, canvasHeight);
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}

function centerOf(rect: Rect): Point {
  return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
}

/**
 * What a press at `point` grabs: the rotation handle, the nearest resize handle within `tolerance`, else the inside, else nothing.
 * The rectangle is turned by `angle` degrees around its center, and the rotation handle sits `rotateOffset` above its top edge.
 * On a small rectangle the reach of the handles shrinks, so that its middle can always be dragged.
 */
export function hitTest(rect: Rect, point: Point, tolerance: number, angle = 0, rotateOffset = 0): SelectionHit {
  // Everything below is done in the frame of the unturned rectangle.
  const local = angle === 0 ? point : rotatePoint(point, -angle, centerOf(rect));
  if (rotateOffset > 0 && Math.hypot(local.x - (rect.x + rect.width / 2), local.y - (rect.y - rotateOffset)) <= tolerance) {
    return { kind: 'rotate' };
  }
  const reach = Math.min(tolerance, Math.min(rect.width, rect.height) / 3);
  let nearest: { handle: PlacementHandle; distance: number } | null = null;
  for (const handle of RESIZE_HANDLES) {
    const [ax, ay] = HANDLE_ANCHORS[handle];
    const distance = Math.max(Math.abs(local.x - (rect.x + rect.width * ax)), Math.abs(local.y - (rect.y + rect.height * ay)));
    if (distance <= reach && (nearest === null || distance < nearest.distance)) {
      nearest = { handle, distance };
    }
  }
  if (nearest !== null) {
    return { kind: 'handle', handle: nearest.handle };
  }
  const inside =
    local.x >= rect.x && local.x < rect.x + rect.width && local.y >= rect.y && local.y < rect.y + rect.height;
  return inside ? { kind: 'inside' } : { kind: 'outside' };
}

/** The point of `rect` on the side opposite to `handle`: the one that stays put while that handle is dragged. */
function oppositeAnchor(rect: Rect, handle: PlacementHandle): Point {
  const [ax, ay] = HANDLE_ANCHORS[handle];
  return { x: rect.x + rect.width * (1 - ax), y: rect.y + rect.height * (1 - ay) };
}

/**
 * Resizes a rectangle that is turned by `angle` degrees. The pointer offset is taken in the frame of the
 * unturned rectangle, and the rectangle is then shifted so that the opposite side does not move on the canvas.
 */
export function resizeRotatedRect(
  start: Rect,
  angle: number,
  handle: PlacementHandle,
  dx: number,
  dy: number,
  keepAspectRatio: boolean,
  canvasWidth: number,
  canvasHeight: number
): Rect {
  if (angle === 0) {
    return resizeRect(start, handle, dx, dy, keepAspectRatio, canvasWidth, canvasHeight);
  }
  const offset = rotatePoint({ x: dx, y: dy }, -angle, { x: 0, y: 0 });
  const next = resizeRect(start, handle, offset.x, offset.y, keepAspectRatio, canvasWidth, canvasHeight);
  const before = rotatePoint(oppositeAnchor(start, handle), angle, centerOf(start));
  const after = rotatePoint(oppositeAnchor(next, handle), angle, centerOf(next));
  return { ...next, x: next.x + Math.round(before.x - after.x), y: next.y + Math.round(before.y - after.y) };
}

/** Moves the rectangle by whole pixels. It may leave the canvas, but at least one pixel stays inside. */
export function moveRect(start: Rect, dx: number, dy: number, canvasWidth: number, canvasHeight: number): Rect {
  return {
    ...start,
    x: clamp(start.x + Math.round(dx), 1 - start.width, canvasWidth - 1),
    y: clamp(start.y + Math.round(dy), 1 - start.height, canvasHeight - 1)
  };
}

/**
 * Resizes from `handle` by the pointer offset `(dx, dy)` since the gesture began; the opposite
 * side stays fixed. The dragged edges stay inside the canvas (unless they already were outside)
 * and keep the rectangle at one pixel or more. With `keepAspectRatio` the proportions of `start`
 * are kept; side handles then scale the other axis around the center.
 */
export function resizeRect(
  start: Rect,
  handle: PlacementHandle,
  dx: number,
  dy: number,
  keepAspectRatio: boolean,
  canvasWidth: number,
  canvasHeight: number
): Rect {
  if (keepAspectRatio) {
    return resizeProportionally(start, handle, dx, dy, canvasWidth, canvasHeight);
  }
  const right = start.x + start.width;
  const bottom = start.y + start.height;
  let nextLeft = start.x;
  let nextRight = right;
  let nextTop = start.y;
  let nextBottom = bottom;
  if (handle.includes('w')) {
    nextLeft = clamp(Math.round(start.x + dx), Math.min(0, start.x), right - 1);
  }
  if (handle.includes('e')) {
    nextRight = clamp(Math.round(right + dx), start.x + 1, Math.max(canvasWidth, right));
  }
  if (handle.includes('n')) {
    nextTop = clamp(Math.round(start.y + dy), Math.min(0, start.y), bottom - 1);
  }
  if (handle.includes('s')) {
    nextBottom = clamp(Math.round(bottom + dy), start.y + 1, Math.max(canvasHeight, bottom));
  }
  return { x: nextLeft, y: nextTop, width: nextRight - nextLeft, height: nextBottom - nextTop };
}

function resizeProportionally(
  start: Rect,
  handle: PlacementHandle,
  dx: number,
  dy: number,
  canvasWidth: number,
  canvasHeight: number
): Rect {
  const west = handle.includes('w');
  const north = handle.includes('n');
  const horizontal = west || handle.includes('e');
  const vertical = north || handle.includes('s');
  const right = start.x + start.width;
  const bottom = start.y + start.height;

  // The largest size the dragged edges may reach; an axis that is not dragged may not outgrow the canvas.
  const maxWidth = !horizontal
    ? Math.max(canvasWidth, start.width)
    : west
      ? right - Math.min(0, start.x)
      : Math.max(canvasWidth, right) - start.x;
  const maxHeight = !vertical
    ? Math.max(canvasHeight, start.height)
    : north
      ? bottom - Math.min(0, start.y)
      : Math.max(canvasHeight, bottom) - start.y;

  const widthScale = (west ? start.width - dx : start.width + dx) / start.width;
  const heightScale = (north ? start.height - dy : start.height + dy) / start.height;
  let requested = widthScale;
  if (!horizontal) {
    requested = heightScale;
  } else if (vertical && Math.abs(heightScale - 1) > Math.abs(widthScale - 1)) {
    requested = heightScale;
  }
  const scale = clamp(requested, Math.max(1 / start.width, 1 / start.height), Math.min(maxWidth / start.width, maxHeight / start.height));

  const width = Math.max(1, Math.round(start.width * scale));
  const height = Math.max(1, Math.round(start.height * scale));
  return {
    x: !horizontal ? start.x + Math.round((start.width - width) / 2) : west ? right - width : start.x,
    y: !vertical ? start.y + Math.round((start.height - height) / 2) : north ? bottom - height : start.y,
    width,
    height
  };
}
