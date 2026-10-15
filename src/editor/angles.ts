import type { Point } from './model';

/** Angles are degrees, clockwise on screen (the y axis points down), as CSS `rotate()` uses them. */

/** `point` turned by `degrees` around `center`. */
export function rotatePoint(point: Point, degrees: number, center: Point): Point {
  const angle = (degrees * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = point.x - center.x;
  const dy = point.y - center.y;
  return { x: center.x + dx * cos - dy * sin, y: center.y + dx * sin + dy * cos };
}

/** Direction of `point` as seen from `center`, in degrees: 0 points right and 90 points down. */
export function angleOf(center: Point, point: Point): number {
  return (Math.atan2(point.y - center.y, point.x - center.x) * 180) / Math.PI;
}

/** Degrees brought into `(-180, 180]`. */
export function normalizeDegrees(degrees: number): number {
  const wrapped = ((degrees % 360) + 360) % 360;
  return wrapped > 180 ? wrapped - 360 : wrapped;
}
