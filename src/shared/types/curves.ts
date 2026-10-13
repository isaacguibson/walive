/** Limits shared by the editor and the persistence layer. */
export const CURVE_LIMITS = {
  maxCurvesPerLayer: 5_000,
  maxAnchorsPerCurve: 5_000,
  /** Largest absolute value of any stored coordinate, in canvas pixels. */
  maxCoordinate: 1_000_000
} as const;

export interface CurvePoint {
  readonly x: number;
  readonly y: number;
}

/** `smooth` anchors keep their two handles collinear; `corner` anchors move them independently. */
export type AnchorType = 'corner' | 'smooth';

export interface CurveAnchorData extends CurvePoint {
  readonly type: AnchorType;
  /** Control point on the incoming side, as an offset from the anchor. `(0, 0)` means no handle. */
  readonly handleIn: CurvePoint;
  /** Control point on the outgoing side, as an offset from the anchor. `(0, 0)` means no handle. */
  readonly handleOut: CurvePoint;
}

/** How a curve is drawn. Captured when the curve is created and kept until it is explicitly changed. */
export interface CurveStyleData {
  /** Brush type id. */
  readonly brush: string;
  readonly settings: Readonly<Record<string, number>>;
  /** `#rrggbb`. */
  readonly color: string;
  /** Diameter in canvas pixels. */
  readonly size: number;
  /** Opacity in percent (0-100). */
  readonly opacity: number;
  /** Makes randomized brushes reproducible. */
  readonly seed: number;
}

/** A cubic Bézier path (open) stored on a layer. Identifiers are unique within their layer. */
export interface BezierCurveData {
  readonly id: string;
  readonly anchors: readonly CurveAnchorData[];
  readonly style: CurveStyleData;
}
