import { hasHandle, type BezierCurve } from '@editor/curves/curve';

interface CurveOverlayProps {
  curve: BezierCurve;
  /** The curve is still being drawn and is not on the layer yet. */
  isDraft: boolean;
  selectedAnchor: number | null;
  width: number;
  height: number;
  /** Zoom factor: marker sizes are divided by it so they keep their on-screen size. */
  scale: number;
}

const ANCHOR_SIZE = 8;
const HANDLE_RADIUS = 4;

/** SVG path data of a curve: one cubic segment between each pair of anchors. */
export function curvePathData(curve: BezierCurve): string {
  const [first, ...rest] = curve.anchors;
  if (first === undefined) {
    return '';
  }
  let data = `M ${first.x} ${first.y}`;
  let previous = first;
  for (const anchor of rest) {
    data += ` C ${previous.x + previous.handleOut.x} ${previous.y + previous.handleOut.y} ${anchor.x + anchor.handleIn.x} ${anchor.y + anchor.handleIn.y} ${anchor.x} ${anchor.y}`;
    previous = anchor;
  }
  return data;
}

/**
 * Editing marks of a curve: its path, anchors and control handles. They live in an overlay
 * above the canvas, so they never become part of the drawing.
 */
export function CurveOverlay({ curve, isDraft, selectedAnchor, width, height, scale }: CurveOverlayProps) {
  const anchorSize = ANCHOR_SIZE / scale;
  return (
    <svg
      className="curve-overlay"
      data-testid="curve-overlay"
      data-draft={isDraft ? 'true' : 'false'}
      viewBox={`0 0 ${width} ${height}`}
      aria-hidden="true"
    >
      <path className="curve-overlay-path" d={curvePathData(curve)} />
      {curve.anchors.map((anchor, index) => {
        const selected = index === selectedAnchor;
        return (
          <g key={index}>
            {(['in', 'out'] as const).map((side) => {
              const handle = side === 'in' ? anchor.handleIn : anchor.handleOut;
              if (!hasHandle(handle)) {
                return null;
              }
              return (
                <g key={side}>
                  <line className="curve-overlay-handle-line" x1={anchor.x} y1={anchor.y} x2={anchor.x + handle.x} y2={anchor.y + handle.y} />
                  <circle
                    className="curve-overlay-handle"
                    data-testid={`curve-handle-${side}`}
                    cx={anchor.x + handle.x}
                    cy={anchor.y + handle.y}
                    r={HANDLE_RADIUS / scale}
                  />
                </g>
              );
            })}
            {anchor.type === 'smooth' ? (
              <circle
                className="curve-overlay-anchor"
                data-testid="curve-anchor"
                data-type={anchor.type}
                data-selected={selected ? 'true' : 'false'}
                cx={anchor.x}
                cy={anchor.y}
                r={anchorSize / 2}
              />
            ) : (
              <rect
                className="curve-overlay-anchor"
                data-testid="curve-anchor"
                data-type={anchor.type}
                data-selected={selected ? 'true' : 'false'}
                x={anchor.x - anchorSize / 2}
                y={anchor.y - anchorSize / 2}
                width={anchorSize}
                height={anchorSize}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}
