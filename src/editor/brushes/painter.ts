import { paintVariableSegment, type Grain } from '../drawing/brush';
import type { BrushSample, BrushStroke, BrushStrokeContext } from './brush';

/**
 * Paints the segments of one stroke on the canvas. Keeps the per-stroke buffer that
 * stops overlapping segments from stacking, allocating it only when needed.
 */
export class StrokePainter {
  private peak: Uint8Array | null = null;

  /** `accumulate` must be `true` whenever the opacity or the grain makes overlaps visible. */
  constructor(
    private readonly context: BrushStrokeContext,
    private readonly accumulate: boolean
  ) {}

  paint(from: BrushSample, to: BrushSample, grain?: Grain): void {
    const { canvas, color } = this.context;
    canvas.apply((drawing, original) => {
      const style = this.accumulate
        ? {
            start: from.opacity,
            end: to.opacity,
            grain,
            peak: (this.peak ??= new Uint8Array(drawing.width * drawing.height)),
            original
          }
        : undefined;
      return paintVariableSegment(drawing, from, to, from.size, to.size, { kind: 'paint', color }, style);
    });
  }

  release(): void {
    this.peak = null;
  }
}

/** A continuous stroke of round-capped segments, optionally textured by a per-pixel grain. */
export class SegmentStroke implements BrushStroke {
  private readonly painter: StrokePainter;
  private last: BrushSample | null = null;

  constructor(context: BrushStrokeContext, private readonly grain?: Grain) {
    this.painter = new StrokePainter(context, grain !== undefined || context.variableOpacity);
  }

  begin(sample: BrushSample): void {
    this.last = sample;
    this.painter.paint(sample, sample, this.grain);
  }

  extend(sample: BrushSample): void {
    this.painter.paint(this.last ?? sample, sample, this.grain);
    this.last = sample;
  }

  end(): void {
    this.last = null;
    this.painter.release();
  }
}
