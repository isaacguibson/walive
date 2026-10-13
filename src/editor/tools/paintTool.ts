import type { BrushCanvas, BrushSample, BrushStroke } from '../brushes/brush';
import { MIN_PRESSURE_OPACITY } from '../constants';
import { paintVariableSegment } from '../drawing/brush';
import { StrokeStabilizer } from '../drawing/stabilizer';
import type { ToolType } from '../model';
import { toPoint, type EditorTool, type StrokeHandle, type ToolContext, type ToolPointerEvent } from './tool';

/** Settings of one stroke, read when it starts so that they stay fixed until it ends. */
interface StrokeDynamics {
  /** Configured diameter in canvas pixels. */
  size: number;
  /** Base opacity from 0 to 1. */
  opacity: number;
  pressureSize: boolean;
  pressureOpacity: boolean;
  stabilize: boolean;
}

interface PaintToolOptions {
  id: ToolType;
  name: string;
  /** Label of the undo entry. */
  label: string;
  dynamics(): StrokeDynamics;
  /** `variableOpacity` tells whether the opacity of the samples can differ from fully opaque. */
  startStroke(canvas: BrushCanvas, variableOpacity: boolean): BrushStroke;
}

interface ActiveStroke {
  handle: StrokeHandle;
  painter: BrushStroke;
  dynamics: StrokeDynamics;
  stabilizer: StrokeStabilizer | null;
}

/**
 * Shared input handling of the Brush and the Eraser: continuous strokes on the active
 * layer. It resolves stabilization and pen pressure; drawing is up to the stroke renderer.
 */
export class PaintTool implements EditorTool {
  readonly id: ToolType;
  readonly name: string;
  private active: ActiveStroke | null = null;

  constructor(
    private readonly context: ToolContext,
    private readonly options: PaintToolOptions
  ) {
    this.id = options.id;
    this.name = options.name;
  }

  activate(): void {}

  deactivate(): void {
    this.finish();
  }

  pointerDown(event: ToolPointerEvent): void {
    this.finish();
    const handle = this.context.beginStroke(this.options.label);
    if (handle === null) {
      return;
    }
    const dynamics = this.options.dynamics();
    this.active = {
      handle,
      dynamics,
      stabilizer: dynamics.stabilize ? new StrokeStabilizer(this.context.getStabilizeRadius()) : null,
      painter: this.options.startStroke(handle, dynamics.pressureOpacity || dynamics.opacity < 1)
    };
    this.active.painter.begin(this.sample(event, this.active));
  }

  pointerMove(event: ToolPointerEvent): void {
    if (this.active !== null) {
      this.active.painter.extend(this.sample(event, this.active));
    }
  }

  pointerUp(event: ToolPointerEvent): void {
    // With stabilization the stroke ends where the rope left it, not at the release point.
    this.pointerMove(event);
    this.finish();
  }

  pointerCancel(): void {
    this.finish();
  }

  private sample(event: ToolPointerEvent, { dynamics, stabilizer }: ActiveStroke): BrushSample {
    const point = stabilizer?.push(toPoint(event)) ?? toPoint(event);
    const pressure = penPressure(event);
    return {
      ...point,
      size: dynamics.pressureSize && pressure !== null ? Math.max(1, dynamics.size * pressure) : dynamics.size,
      opacity:
        dynamics.pressureOpacity && pressure !== null
          ? dynamics.opacity * (MIN_PRESSURE_OPACITY + pressure * (1 - MIN_PRESSURE_OPACITY))
          : dynamics.opacity
    };
  }

  private finish(): void {
    if (this.active === null) {
      return;
    }
    const { painter, handle, stabilizer } = this.active;
    painter.end();
    handle.commit();
    stabilizer?.reset();
    this.active = null;
  }
}

/** Pen pressure in `[0, 1]`, or `null` for mouse input and missing or invalid values. */
function penPressure(event: ToolPointerEvent): number | null {
  const pressure = event.pressure;
  if (event.pointerType !== 'pen' || pressure === undefined || !Number.isFinite(pressure) || pressure < 0 || pressure > 1) {
    return null;
  }
  return pressure;
}

/** Removes opacity along the path with round-capped segments. */
class EraseStroke implements BrushStroke {
  private last: BrushSample | null = null;

  constructor(private readonly canvas: BrushCanvas) {}

  begin(sample: BrushSample): void {
    this.last = sample;
    this.erase(sample, sample);
  }

  extend(sample: BrushSample): void {
    this.erase(this.last ?? sample, sample);
    this.last = sample;
  }

  end(): void {
    this.last = null;
  }

  private erase(from: BrushSample, to: BrushSample): void {
    this.canvas.apply((drawing) => paintVariableSegment(drawing, from, to, from.size, to.size, { kind: 'erase' }));
  }
}

export function createBrushTool(context: ToolContext): PaintTool {
  return new PaintTool(context, {
    id: 'brush',
    name: 'Brush',
    label: 'Brush stroke',
    dynamics: () => ({
      size: context.getBrushSize(),
      opacity: context.getBrushOpacity(),
      pressureSize: context.getUsePenPressure(),
      pressureOpacity: context.getUsePenPressureOpacity(),
      stabilize: context.getStabilizeStroke()
    }),
    startStroke: (canvas, variableOpacity) => {
      const { brush, settings } = context.getBrush();
      return brush.startStroke(settings, {
        canvas,
        color: context.getColor(),
        seed: context.nextStrokeSeed(),
        variableOpacity
      });
    }
  });
}

export function createEraserTool(context: ToolContext): PaintTool {
  return new PaintTool(context, {
    id: 'eraser',
    name: 'Eraser',
    label: 'Erase',
    dynamics: () => ({
      size: context.getEraserSize(),
      opacity: 1,
      pressureSize: false,
      pressureOpacity: false,
      stabilize: false
    }),
    startStroke: (canvas) => new EraseStroke(canvas)
  });
}
