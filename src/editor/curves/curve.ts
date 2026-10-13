import type { Point } from '../model';
import type { AnchorType, BezierCurveData, CurveAnchorData, CurveStyleData } from '@shared/types/curves';

export type BezierCurve = BezierCurveData;
export type CurveAnchor = CurveAnchorData;
export type CurveStyle = CurveStyleData;
export type { AnchorType };

export const NO_HANDLE: Point = { x: 0, y: 0 };

export function hasHandle(handle: Point): boolean {
  return handle.x !== 0 || handle.y !== 0;
}
