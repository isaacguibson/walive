import { angleOf, rotatePoint } from '../angles';
import type { Point } from '../model';

export type ShapeKind = 'square' | 'triangle' | 'circle' | 'line';

export const SHAPE_KINDS: readonly { readonly id: ShapeKind; readonly name: string }[] = [
  { id: 'square', name: 'Square' },
  { id: 'triangle', name: 'Triangle' },
  { id: 'circle', name: 'Circle' },
  { id: 'line', name: 'Straight Line' }
];

export const MIN_SHAPE_SIZE = 1;
export const MAX_SHAPE_SIZE = 1000;
export const MIN_SHAPE_STROKE = 1;
export const MAX_SHAPE_STROKE = 100;

/** What the user configures in Tool Options; it applies to the pending shape and to the next one. */
export interface ShapeOptions {
  readonly kind: ShapeKind;
  /** Side of a square or an equilateral triangle, diameter of a circle, length of a line (canvas pixels). */
  readonly size: number;
  /** Degrees, clockwise on screen, around the center of the shape (the midpoint of a line). */
  readonly rotation: number;
  /** Outline and line thickness in canvas pixels. */
  readonly strokeWidth: number;
  /** Fill the shape instead of outlining it. A line is never filled. */
  readonly fill: boolean;
  /** Percent, 0-100. */
  readonly opacity: number;
}

export const DEFAULT_SHAPE_OPTIONS: ShapeOptions = { kind: 'square', size: 100, rotation: 0, strokeWidth: 4, fill: false, opacity: 100 };

/** A shape that is being placed. It lives in canvas coordinates and is not part of the layer until it is confirmed. */
export interface Shape extends ShapeOptions {
  readonly center: Point;
  /** `#rrggbb`. */
  readonly color: string;
}

export interface ShapeEditorState {
  readonly pending: Shape | null;
}

const SQRT3 = Math.sqrt(3);

/**
 * Corners of the shape in canvas pixels, after rotation. A circle is a regular polygon fine enough to
 * look round; a line has two points. The transformation origin is `shape.center`.
 */
export function shapeOutline(shape: Shape): Point[] {
  const half = shape.size / 2;
  let local: Point[];
  switch (shape.kind) {
    case 'square':
      local = [
        { x: -half, y: -half },
        { x: half, y: -half },
        { x: half, y: half },
        { x: -half, y: half }
      ];
      break;
    case 'triangle': {
      const radius = shape.size / SQRT3;
      local = [-90, 30, 150].map((degrees) => ({ x: radius * Math.cos((degrees * Math.PI) / 180), y: radius * Math.sin((degrees * Math.PI) / 180) }));
      break;
    }
    case 'circle': {
      const count = Math.min(720, Math.max(32, Math.ceil(half * 1.5)));
      local = Array.from({ length: count }, (_, index) => ({ x: half * Math.cos((index / count) * 2 * Math.PI), y: half * Math.sin((index / count) * 2 * Math.PI) }));
      break;
    }
    case 'line':
      local = [
        { x: -half, y: 0 },
        { x: half, y: 0 }
      ];
      break;
  }
  return local.map((point) => rotatePoint({ x: shape.center.x + point.x, y: shape.center.y + point.y }, shape.rotation, shape.center));
}

/** The distance from the center to the farthest point the shape reaches, strokes included. */
export function shapeReach(shape: Shape): number {
  const stroke = shape.strokeWidth / 2;
  switch (shape.kind) {
    case 'square':
      return (shape.size * Math.SQRT2) / 2 + stroke;
    case 'triangle':
      return shape.size / SQRT3 + stroke;
    case 'circle':
    case 'line':
      return shape.size / 2 + stroke;
  }
}

/** Distance from `point` to the segment `from`-`to`. */
function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - from.x) * dx + (point.y - from.y) * dy) / length));
  return Math.hypot(point.x - (from.x + dx * t), point.y - (from.y + dy * t));
}

/** The two ends of a line, start first. */
export function lineEnds(shape: Shape): [Point, Point] {
  const [start, end] = shapeOutline({ ...shape, kind: 'line' });
  return [start as Point, end as Point];
}

/**
 * The editing area of a pending shape: the circle that contains it, or for a line the band along it.
 * A press inside it moves the shape, outside confirms it.
 */
export function isInEditingArea(shape: Shape, point: Point, tolerance: number): boolean {
  if (shape.kind === 'line') {
    const [start, end] = lineEnds(shape);
    return distanceToSegment(point, start, end) <= shape.strokeWidth / 2 + tolerance;
  }
  return Math.hypot(point.x - shape.center.x, point.y - shape.center.y) <= shapeReach(shape) + tolerance;
}

/** The end of a line under `point` (0 = start, 1 = end), or `null`. */
export function pickLineEnd(shape: Shape, point: Point, tolerance: number): 0 | 1 | null {
  if (shape.kind !== 'line') {
    return null;
  }
  const [start, end] = lineEnds(shape);
  const toStart = Math.hypot(point.x - start.x, point.y - start.y);
  const toEnd = Math.hypot(point.x - end.x, point.y - end.y);
  if (Math.min(toStart, toEnd) > tolerance) {
    return null;
  }
  return toStart <= toEnd ? 0 : 1;
}

function clampSize(size: number): number {
  return Math.min(MAX_SHAPE_SIZE, Math.max(MIN_SHAPE_SIZE, Math.round(size)));
}

/**
 * The shape that a drag from `from` to `to` spans. A square, triangle or circle gets the longer side of the
 * drag as its size and sits in the square that starts at `from` and goes toward `to`. A line runs exactly from
 * `from` to `to`, at any length: its length and angle come from the drag and its center is the midpoint.
 */
export function shapeFromDrag(base: Shape, from: Point, to: Point): Shape {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (base.kind === 'line') {
    return {
      ...base,
      size: Math.hypot(dx, dy),
      rotation: angleOf(from, to),
      center: { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }
    };
  }
  const size = clampSize(Math.max(Math.abs(dx), Math.abs(dy)));
  return {
    ...base,
    size,
    center: { x: from.x + (dx < 0 ? -size : size) / 2, y: from.y + (dy < 0 ? -size : size) / 2 }
  };
}
