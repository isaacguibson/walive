/** Default playback speed (HU_00004 §40). */
export const DEFAULT_FPS = 24;
export const FPS_PRESETS: readonly number[] = [24, 30, 60, 120];
/** Upper bound that keeps the playback timer from spinning; any positive integer up to this is accepted. */
export const MAX_FPS = 1000;

export const DEFAULT_ZOOM = 100;
export const MIN_ZOOM = 1;
export const MAX_ZOOM = 800;

/** Default tool sizes in pixels. Change here to adjust the initial drawing feel. */
export const DEFAULT_BRUSH_SIZE = 12;
/** Default base opacity of brush strokes, in percent. */
export const DEFAULT_BRUSH_OPACITY = 100;
export const DEFAULT_ERASER_SIZE = 20;
export const MIN_TOOL_SIZE = 1;
export const MAX_TOOL_SIZE = 500;

export const DEFAULT_COLOR = '#000000';

/** Number of undoable commands kept in memory. */
export const MAX_HISTORY_ENTRIES = 100;

/** Maximum number of frames that can be created by one "add frames" operation. */
export const MAX_ADD_FRAMES = 1000;

/** The raster is `width * height * 4` bytes per layer, so very large canvases are refused. */
export const MAX_CANVAS_DIMENSION = 16_384;
export const MAX_CANVAS_PIXELS = 36_000_000;

export const DEFAULT_LAYER_NAME = 'Layer';

/** Length of the stroke stabilizer rope, in screen pixels (independent of zoom). */
export const STABILIZE_SCREEN_RADIUS = 15;

/** Opacity of a pen stroke at zero pressure when pressure controls opacity; full pressure is fully opaque. */
export const MIN_PRESSURE_OPACITY = 0.1;
