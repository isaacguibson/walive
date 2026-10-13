import type { BrushId, BrushSettings, DrawingData, Rect, Rgb } from '../model';

/** One processed input sample: canvas position plus size and opacity already resolved from pen pressure. */
export interface BrushSample {
  readonly x: number;
  readonly y: number;
  /** Diameter in canvas pixels. */
  readonly size: number;
  /** Opacity from 0 to 1. */
  readonly opacity: number;
}

/** Where a brush draws. Implemented by the stroke handle of the animation engine. */
export interface BrushCanvas {
  /** `original` holds the pixels as they were before the stroke (`null` when the drawing was blank). */
  apply(operation: (drawing: DrawingData, original: Uint8ClampedArray | null) => Rect | null): void;
}

export interface BrushStrokeContext {
  readonly canvas: BrushCanvas;
  readonly color: Rgb;
  /** Makes randomized brushes reproducible: the same seed and path always give the same marks. */
  readonly seed: number;
  /** Whether the opacity of the samples may differ from fully opaque. */
  readonly variableOpacity: boolean;
}

/** The rendering of one stroke. Its settings are fixed when it starts. */
export interface BrushStroke {
  begin(sample: BrushSample): void;
  extend(sample: BrushSample): void;
  /** Releases the temporary resources of the stroke. */
  end(): void;
}

/** A numeric brush setting that the UI can edit. */
export interface BrushOption {
  readonly key: string;
  readonly label: string;
  readonly min: number;
  readonly max: number;
  readonly unit: '%' | 'px';
}

/**
 * A brush type. Input collection, pressure and stabilization happen before the brush
 * (they produce `BrushSample`s); the brush only decides how samples become pixels.
 */
export interface BrushDefinition<S extends BrushSettings = BrushSettings> {
  readonly id: BrushId;
  readonly name: string;
  readonly options: readonly BrushOption[];
  readonly defaultSettings: S;
  startStroke(settings: S, context: BrushStrokeContext): BrushStroke;
}
