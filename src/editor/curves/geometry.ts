import { CURVE_FLATNESS } from '../constants';
import type { Point } from '../model';
import type { CurveAnchor } from './curve';

/** One cubic segment between two consecutive anchors: start, two control points, end. */
export type Segment = readonly [Point, Point, Point, Point];

/** A point of the flattened path with the segment and parameter it came from. */
export interface PathPoint extends Point {
  readonly segment: number;
  readonly t: number;
}

export interface NearestPoint {
  readonly segment: number;
  readonly t: number;
  readonly point: Point;
  readonly distance: number;
}

const MAX_SUBDIVISION_DEPTH = 16;

export function segmentOf(from: CurveAnchor, to: CurveAnchor): Segment {
  return [
    { x: from.x, y: from.y },
    { x: from.x + from.handleOut.x, y: from.y + from.handleOut.y },
    { x: to.x + to.handleIn.x, y: to.y + to.handleIn.y },
    { x: to.x, y: to.y }
  ];
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function lerp(a: Point, b: Point, t: number): Point {
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
}

/** Splits a segment at `t` (de Casteljau). Both halves describe exactly the same curve. */
export function splitSegment(segment: Segment, t: number): [Segment, Segment] {
  const [p0, p1, p2, p3] = segment;
  const p01 = lerp(p0, p1, t);
  const p12 = lerp(p1, p2, t);
  const p23 = lerp(p2, p3, t);
  const p012 = lerp(p01, p12, t);
  const p123 = lerp(p12, p23, t);
  const middle = lerp(p012, p123, t);
  return [
    [p0, p01, p012, middle],
    [middle, p123, p23, p3]
  ];
}

/** Nearest point of the straight piece `a`-`b` to `p`, with its position along the piece (0-1). */
function closestOnPiece(a: Point, b: Point, p: Point): { point: Point; u: number } {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const u = lengthSquared === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared));
  return { point: { x: a.x + dx * u, y: a.y + dy * u }, u };
}

/** Both control points lie within `tolerance` of the chord, so the curve does too. */
function isFlat([p0, p1, p2, p3]: Segment, tolerance: number): boolean {
  return (
    distance(p1, closestOnPiece(p0, p3, p1).point) <= tolerance && distance(p2, closestOnPiece(p0, p3, p2).point) <= tolerance
  );
}

function flattenSegment(segment: Segment, index: number, t0: number, t1: number, tolerance: number, depth: number, out: PathPoint[]): void {
  if (depth >= MAX_SUBDIVISION_DEPTH || isFlat(segment, tolerance)) {
    out.push({ ...segment[3], segment: index, t: t1 });
    return;
  }
  const [left, right] = splitSegment(segment, 0.5);
  const middle = (t0 + t1) / 2;
  flattenSegment(left, index, t0, middle, tolerance, depth + 1, out);
  flattenSegment(right, index, middle, t1, tolerance, depth + 1, out);
}

/** Polyline that follows the path within `tolerance` canvas pixels. Needs at least one anchor. */
export function flattenAnchors(anchors: readonly CurveAnchor[], tolerance: number = CURVE_FLATNESS): PathPoint[] {
  const first = anchors[0] as CurveAnchor;
  const points: PathPoint[] = [{ x: first.x, y: first.y, segment: 0, t: 0 }];
  for (let index = 0; index < anchors.length - 1; index += 1) {
    flattenSegment(segmentOf(anchors[index] as CurveAnchor, anchors[index + 1] as CurveAnchor), index, 0, 1, tolerance, 0, points);
  }
  return points;
}

export function pathLength(points: readonly Point[]): number {
  let length = 0;
  for (let index = 1; index < points.length; index += 1) {
    length += distance(points[index - 1] as Point, points[index] as Point);
  }
  return length;
}

/** Bounding box of the control polygon: the path never leaves it. */
export function controlBounds(anchors: readonly CurveAnchor[]): { minX: number; minY: number; maxX: number; maxY: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const anchor of anchors) {
    for (const point of [anchor, { x: anchor.x + anchor.handleIn.x, y: anchor.y + anchor.handleIn.y }, { x: anchor.x + anchor.handleOut.x, y: anchor.y + anchor.handleOut.y }]) {
      minX = Math.min(minX, point.x);
      minY = Math.min(minY, point.y);
      maxX = Math.max(maxX, point.x);
      maxY = Math.max(maxY, point.y);
    }
  }
  return { minX, minY, maxX, maxY };
}

/** The point of the path nearest to `target`; `null` when the target is farther than `maxDistance`. */
export function nearestOnPath(anchors: readonly CurveAnchor[], target: Point, maxDistance: number): NearestPoint | null {
  const bounds = controlBounds(anchors);
  if (
    target.x < bounds.minX - maxDistance ||
    target.x > bounds.maxX + maxDistance ||
    target.y < bounds.minY - maxDistance ||
    target.y > bounds.maxY + maxDistance
  ) {
    return null;
  }
  const points = flattenAnchors(anchors);
  let best: NearestPoint | null = null;
  for (let index = 1; index < points.length; index += 1) {
    const from = points[index - 1] as PathPoint;
    const to = points[index] as PathPoint;
    const { point, u } = closestOnPiece(from, to, target);
    const separation = distance(point, target);
    if (separation <= maxDistance && (best === null || separation < best.distance)) {
      const startT = from.segment === to.segment ? from.t : 0;
      best = { segment: to.segment, t: startT + (to.t - startT) * u, point, distance: separation };
    }
  }
  return best;
}
