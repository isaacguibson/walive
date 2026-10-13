import {
  MAX_EXPORT_DIMENSION,
  MAX_EXPORT_FPS,
  MAX_EXPORT_PIXELS,
  type AnimationFormatId,
  type DestinationQuery,
  type ExportKind,
  type ExportRequest,
  type ExportResolution,
  type FrameRange,
  type QualityPreset,
  type SceneScope
} from '@shared/types/export';

export const FPS_PRESETS = [24, 30, 60, 120] as const;

export const EXPORT_KIND_LABELS: Record<ExportKind, string> = {
  'current-frame': 'Current Frame (PNG)',
  frames: 'All Frames (PNG Files)',
  'frames-zip': 'All Frames (ZIP Archive)',
  animation: 'Animation'
};

export const QUALITY_LABELS: Record<QualityPreset, string> = {
  low: 'Low File Size',
  balanced: 'Balanced',
  high: 'High Quality'
};

export const FORMAT_LABELS: Record<AnimationFormatId, string> = { mp4: 'MP4 (H.264)', gif: 'GIF' };

/** Everything about the open scene and project that the export settings depend on. */
export interface ExportContext {
  projectName: string;
  sceneName: string;
  canvasWidth: number;
  canvasHeight: number;
  frameCount: number;
  activeFrameId: string;
  /** 1-based position of the active frame. */
  activeFrameNumber: number;
  /** Playback frame rate of the scene; it is not stored in the project, so the editor supplies it. */
  sceneFps: number;
}

/** Form state; numeric fields stay text so half-typed values are not lost. */
export interface ExportSettings {
  kind: ExportKind;
  scope: SceneScope;
  format: AnimationFormatId;
  customRange: boolean;
  rangeStart: string;
  rangeEnd: string;
  customResolution: boolean;
  width: string;
  height: string;
  keepAspectRatio: boolean;
  customFps: boolean;
  fps: string;
  transparentBackground: boolean;
  color: string;
  quality: QualityPreset;
  loop: boolean;
}

export function defaultSettings(context: ExportContext): ExportSettings {
  return {
    kind: 'current-frame',
    scope: 'active',
    format: 'mp4',
    customRange: false,
    rangeStart: '1',
    rangeEnd: String(context.frameCount),
    customResolution: false,
    width: String(context.canvasWidth),
    height: String(context.canvasHeight),
    keepAspectRatio: true,
    customFps: false,
    fps: String(context.sceneFps),
    transparentBackground: true,
    color: '#ffffff',
    quality: 'balanced',
    loop: true
  };
}

/** MP4 cannot hold transparency, so it always uses the background color. */
export function usesTransparency(settings: ExportSettings): boolean {
  return settings.format === 'gif' && settings.transparentBackground;
}

/** Updates one output dimension and, when the ratio is locked, the other one with it. */
export function withDimension(settings: ExportSettings, context: ExportContext, side: 'width' | 'height', value: string): ExportSettings {
  const next = { ...settings, [side]: value };
  const parsed = parseWholeNumber(value);
  if (!settings.keepAspectRatio || parsed === null) {
    return next;
  }
  const ratio = context.canvasWidth / context.canvasHeight;
  return side === 'width'
    ? { ...next, height: String(Math.max(1, Math.round(parsed / ratio))) }
    : { ...next, width: String(Math.max(1, Math.round(parsed * ratio))) };
}

function parseWholeNumber(value: string): number | null {
  return /^\d{1,9}$/.test(value.trim()) ? Number(value) : null;
}

function resolutionOf(settings: ExportSettings): ExportResolution | string {
  if (!settings.customResolution) {
    return { mode: 'original' };
  }
  const width = parseWholeNumber(settings.width);
  const height = parseWholeNumber(settings.height);
  if (width === null || height === null || width < 1 || height < 1) {
    return 'Width and height must be whole numbers greater than zero.';
  }
  if (width > MAX_EXPORT_DIMENSION || height > MAX_EXPORT_DIMENSION) {
    return `Width and height cannot exceed ${MAX_EXPORT_DIMENSION} pixels.`;
  }
  if (width * height > MAX_EXPORT_PIXELS) {
    return 'This resolution is too large to export. Choose a smaller size.';
  }
  return { mode: 'custom', width, height };
}

function rangeOf(settings: ExportSettings, context: ExportContext): FrameRange | null | string {
  if (!settings.customRange || settings.scope === 'all') {
    return null;
  }
  const start = parseWholeNumber(settings.rangeStart);
  const end = parseWholeNumber(settings.rangeEnd);
  const last = context.frameCount;
  if (start === null || start < 1 || start > last) {
    return `The first frame must be a number between 1 and ${last}.`;
  }
  if (end === null || end < 1 || end > last) {
    return `The last frame must be a number between 1 and ${last}.`;
  }
  return start > end ? 'The first frame cannot come after the last frame.' : { start, end };
}

function fpsOf(settings: ExportSettings, context: ExportContext): number | string {
  if (!settings.customFps) {
    return context.sceneFps;
  }
  const fps = parseWholeNumber(settings.fps);
  return fps === null || fps < 1 || fps > MAX_EXPORT_FPS ? `The frame rate must be a whole number between 1 and ${MAX_EXPORT_FPS}.` : fps;
}

export type RequestPlan = { error: string } | { error: null; build(destinationId: string, overwrite: boolean): ExportRequest };

/** Validates the settings; when they are valid, returns a builder for the request once a destination was chosen. */
export function planRequest(settings: ExportSettings, context: ExportContext): RequestPlan {
  if (settings.kind === 'current-frame') {
    return { error: null, build: (destinationId, overwrite) => ({ destinationId, overwrite, kind: 'current-frame', frameId: context.activeFrameId }) };
  }
  const range = rangeOf(settings, context);
  const resolution = resolutionOf(settings);
  const fps = fpsOf(settings, context);
  if (typeof range === 'string') {
    return { error: range };
  }
  if (typeof resolution === 'string') {
    return { error: resolution };
  }
  if (typeof fps === 'string' && settings.kind === 'animation') {
    return { error: fps };
  }
  const { kind } = settings;
  return {
    error: null,
    build: (destinationId, overwrite) => {
      const sequence = { destinationId, overwrite, scope: settings.scope, range, resolution };
      if (kind !== 'animation') {
        return { ...sequence, kind };
      }
      return {
        ...sequence,
        kind,
        format: settings.format,
        fps: typeof fps === 'number' ? fps : context.sceneFps,
        background: usesTransparency(settings) ? { type: 'transparent' } : { type: 'color', color: settings.color },
        quality: settings.quality,
        loop: settings.format === 'gif' && settings.loop
      };
    }
  };
}

const pad = (value: number): string => String(value).padStart(4, '0');

/** What the native dialog proposes as the name of the output. */
export function buildDestinationQuery(settings: ExportSettings, context: ExportContext): DestinationQuery {
  const scope = settings.kind === 'current-frame' ? 'active' : settings.scope;
  const suggestedName =
    settings.kind === 'current-frame'
      ? `${context.sceneName}_frame_${pad(context.activeFrameNumber)}`
      : scope === 'all'
        ? context.projectName
        : context.sceneName;
  return { kind: settings.kind, scope, format: settings.format, suggestedName };
}

/** Label/value pairs shown before the export starts. */
export function summarize(settings: ExportSettings, context: ExportContext): Array<[string, string]> {
  const { kind } = settings;
  const rows: Array<[string, string]> = [['Export', kind === 'animation' ? `Animation (${FORMAT_LABELS[settings.format]})` : EXPORT_KIND_LABELS[kind]]];
  if (kind === 'current-frame') {
    rows.push(['Frame', `${context.activeFrameNumber} of ${context.frameCount} in ${context.sceneName}`]);
  } else {
    rows.push(['Scenes', settings.scope === 'all' ? 'All scenes' : context.sceneName]);
    const range = rangeOf(settings, context);
    rows.push(['Frames', typeof range === 'object' && range !== null ? `${range.start} to ${range.end}` : 'All frames']);
  }
  const size = settings.customResolution ? `${settings.width} × ${settings.height}` : `${context.canvasWidth} × ${context.canvasHeight}`;
  rows.push(['Resolution', `${size} px${settings.customResolution ? '' : ' (original)'}`]);
  if (kind === 'animation') {
    rows.push(['Frame rate', `${settings.customFps ? settings.fps : context.sceneFps} FPS`]);
    rows.push(['Background', usesTransparency(settings) ? 'Transparent' : settings.color]);
  }
  return rows;
}
