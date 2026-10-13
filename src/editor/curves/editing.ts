import { CURVE_LIMITS } from '@shared/types/curves';
import { MIN_ANCHOR_DISTANCE } from '../constants';
import type { Point } from '../model';
import { NO_HANDLE, hasHandle, type AnchorType, type BezierCurve, type CurveAnchor } from './curve';
import { distance, flattenAnchors, pathLength, segmentOf, splitSegment } from './geometry';

const MIN_ANCHORS = 2;

function bound(value: number): number {
  return Math.min(CURVE_LIMITS.maxCoordinate, Math.max(-CURVE_LIMITS.maxCoordinate, value));
}

function boundPoint(point: Point): Point {
  return { x: bound(point.x), y: bound(point.y) };
}

function withAnchor(curve: BezierCurve, index: number, anchor: CurveAnchor): BezierCurve {
  return { ...curve, anchors: curve.anchors.map((existing, position) => (position === index ? anchor : existing)) };
}

function scale(vector: Point, length: number): Point {
  const size = Math.hypot(vector.x, vector.y);
  return size === 0 ? NO_HANDLE : { x: (vector.x / size) * length, y: (vector.y / size) * length };
}

/** A corner anchor without handles. */
export function createAnchor(point: Point): CurveAnchor {
  return { ...boundPoint(point), type: 'corner', handleIn: NO_HANDLE, handleOut: NO_HANDLE };
}

/** Path with fewer than two anchors, or whose anchors all coincide, cannot be drawn. */
export function isDrawableCurve(curve: BezierCurve): boolean {
  return curve.anchors.length >= MIN_ANCHORS && pathLength(flattenAnchors(curve.anchors)) >= MIN_ANCHOR_DISTANCE;
}

export function appendAnchor(curve: BezierCurve, anchor: CurveAnchor): BezierCurve {
  return { ...curve, anchors: [...curve.anchors, anchor] };
}

export function moveCurve(curve: BezierCurve, dx: number, dy: number): BezierCurve {
  return { ...curve, anchors: curve.anchors.map((anchor) => ({ ...anchor, ...boundPoint({ x: anchor.x + dx, y: anchor.y + dy }) })) };
}

/** Moves an anchor together with its handles. */
export function moveAnchor(curve: BezierCurve, index: number, to: Point): BezierCurve {
  const anchor = curve.anchors[index];
  return anchor === undefined ? curve : withAnchor(curve, index, { ...anchor, ...boundPoint(to) });
}

/** Changes the type of an anchor without touching its geometry. */
export function retypeAnchor(curve: BezierCurve, index: number, type: AnchorType): BezierCurve {
  const anchor = curve.anchors[index];
  return anchor === undefined || anchor.type === type ? curve : withAnchor(curve, index, { ...anchor, type });
}

/**
 * Places one handle of an anchor at the absolute position `to`. On a smooth anchor the
 * opposite handle turns with it and keeps its own length.
 */
export function moveHandle(curve: BezierCurve, index: number, side: 'in' | 'out', to: Point): BezierCurve {
  const anchor = curve.anchors[index];
  if (anchor === undefined) {
    return curve;
  }
  const target = boundPoint(to);
  const offset = { x: target.x - anchor.x, y: target.y - anchor.y };
  const own = side === 'in' ? 'handleIn' : 'handleOut';
  const other = side === 'in' ? 'handleOut' : 'handleIn';
  const next: CurveAnchor = { ...anchor, [own]: offset };
  if (anchor.type === 'smooth' && hasHandle(offset)) {
    const length = Math.hypot(anchor[other].x, anchor[other].y);
    return withAnchor(curve, index, { ...next, [other]: scale({ x: -offset.x, y: -offset.y }, length === 0 ? Math.hypot(offset.x, offset.y) : length) });
  }
  return withAnchor(curve, index, next);
}

/**
 * Turns an anchor into a smooth one: its handles become collinear (along the existing
 * handles or, when it has none, along its neighbors) and keep their lengths.
 */
export function smoothAnchor(curve: BezierCurve, index: number): BezierCurve {
  const anchor = curve.anchors[index];
  if (anchor === undefined) {
    return curve;
  }
  const previous = curve.anchors[index - 1];
  const next = curve.anchors[index + 1];
  const direction = hasHandle(anchor.handleIn) || hasHandle(anchor.handleOut)
    ? { x: anchor.handleOut.x - anchor.handleIn.x, y: anchor.handleOut.y - anchor.handleIn.y }
    : { x: (next ?? anchor).x - (previous ?? anchor).x, y: (next ?? anchor).y - (previous ?? anchor).y };
  const lengthOut = hasHandle(anchor.handleOut) ? Math.hypot(anchor.handleOut.x, anchor.handleOut.y) : next ? distance(anchor, next) / 3 : 0;
  const lengthIn = hasHandle(anchor.handleIn) ? Math.hypot(anchor.handleIn.x, anchor.handleIn.y) : previous ? distance(anchor, previous) / 3 : 0;
  const out = scale(direction, lengthOut);
  const back = scale(direction, lengthIn);
  return withAnchor(curve, index, { ...anchor, type: 'smooth', handleOut: out, handleIn: { x: -back.x, y: -back.y } });
}

/** Turns an anchor into a corner: handles stay where they are but move independently from now on. */
export function cornerAnchor(curve: BezierCurve, index: number): BezierCurve {
  return retypeAnchor(curve, index, 'corner');
}

/**
 * Adds an anchor at parameter `t` of a segment without changing the shape of the path.
 * Returns the new curve and the index of the new anchor, or `null` when it would sit on top of a neighbor.
 */
export function insertAnchor(curve: BezierCurve, segment: number, t: number): { curve: BezierCurve; index: number } | null {
  const from = curve.anchors[segment];
  const to = curve.anchors[segment + 1];
  if (from === undefined || to === undefined) {
    return null;
  }
  const [left, right] = splitSegment(segmentOf(from, to), t);
  const middle = left[3];
  if (distance(middle, from) < MIN_ANCHOR_DISTANCE || distance(middle, to) < MIN_ANCHOR_DISTANCE) {
    return null;
  }
  const offset = (handle: Point): Point => ({ x: handle.x - middle.x, y: handle.y - middle.y });
  const created: CurveAnchor = { x: middle.x, y: middle.y, type: 'smooth', handleIn: offset(left[2]), handleOut: offset(right[1]) };
  const anchors = [
    ...curve.anchors.slice(0, segment),
    { ...from, handleOut: { x: left[1].x - from.x, y: left[1].y - from.y } },
    created,
    { ...to, handleIn: { x: right[2].x - to.x, y: right[2].y - to.y } },
    ...curve.anchors.slice(segment + 2)
  ];
  return { curve: { ...curve, anchors }, index: segment + 1 };
}

/** Whether removing an anchor still leaves a path. */
export function canRemoveAnchor(curve: BezierCurve): boolean {
  return curve.anchors.length > MIN_ANCHORS;
}

export function removeAnchor(curve: BezierCurve, index: number): BezierCurve | null {
  if (!canRemoveAnchor(curve) || curve.anchors[index] === undefined) {
    return null;
  }
  return { ...curve, anchors: curve.anchors.filter((_, position) => position !== index) };
}
