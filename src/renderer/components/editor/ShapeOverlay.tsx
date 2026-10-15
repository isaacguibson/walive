import { shapeOutline, type Shape } from '@editor/shapes/geometry';

interface ShapeOverlayProps {
  shape: Shape;
  width: number;
  height: number;
  /** Zoom factor: marker sizes are divided by it so they keep their on-screen size. */
  scale: number;
}

const ANCHOR_SIZE = 8;

/** Dashed outline of the pending shape in canvas coordinates; a line shows its two ends as anchors. It is an overlay, so it never becomes part of the drawing. */
export function ShapeOverlay({ shape, width, height, scale }: ShapeOverlayProps) {
  const outline = shapeOutline(shape);
  const points = outline.map((point) => `${point.x},${point.y}`).join(' ');
  const anchor = ANCHOR_SIZE / scale;
  return (
    <svg className="curve-overlay" data-testid="shape-overlay" data-draft="true" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      {shape.kind === 'line' ? <polyline className="curve-overlay-path" points={points} /> : <polygon className="curve-overlay-path" points={points} />}
      {shape.kind === 'line' ? (
        outline.map((point, index) => (
          <rect key={index} className="curve-overlay-anchor" data-testid="shape-endpoint" x={point.x - anchor / 2} y={point.y - anchor / 2} width={anchor} height={anchor} />
        ))
      ) : (
        <circle className="curve-overlay-anchor" cx={shape.center.x} cy={shape.center.y} r={anchor / 4} />
      )}
    </svg>
  );
}
