export type ExportKind = 'current-frame' | 'frames' | 'frames-zip' | 'animation';

export type SceneScope = 'active' | 'all';

export type AnimationFormatId = 'mp4' | 'gif';

export type QualityPreset = 'low' | 'balanced' | 'high';

/** Inclusive range of 1-based frame numbers on the scene timeline. */
export interface FrameRange {
  start: number;
  end: number;
}

export type ExportResolution = { mode: 'original' } | { mode: 'custom'; width: number; height: number };

export type ExportBackground = { type: 'transparent' } | { type: 'color'; color: string };

/** Largest edge and pixel count accepted for a custom output size. */
export const MAX_EXPORT_DIMENSION = 8192;
export const MAX_EXPORT_PIXELS = 33_177_600;
export const MAX_EXPORT_FPS = 120;

interface ExportCommon {
  /** Destination approved through `chooseDestination`; the renderer never supplies paths. */
  destinationId: string;
  /** Replace files that already exist at the destination. */
  overwrite: boolean;
}

export interface CurrentFrameExport extends ExportCommon {
  kind: 'current-frame';
  frameId: string;
}

export interface FrameSequenceExport extends ExportCommon {
  kind: 'frames' | 'frames-zip';
  scope: SceneScope;
  /** `null` exports every frame. Custom ranges are limited to the active scene. */
  range: FrameRange | null;
  resolution: ExportResolution;
}

export interface AnimationExport extends ExportCommon {
  kind: 'animation';
  format: AnimationFormatId;
  scope: SceneScope;
  range: FrameRange | null;
  resolution: ExportResolution;
  fps: number;
  background: ExportBackground;
  quality: QualityPreset;
  /** GIF only: repeat forever. */
  loop: boolean;
}

export type ExportRequest = CurrentFrameExport | FrameSequenceExport | AnimationExport;

/** What the native dialog has to ask for: a single file or a directory. */
export type DestinationKind = 'file' | 'directory';

export interface DestinationQuery {
  kind: ExportKind;
  scope: SceneScope;
  format: AnimationFormatId;
  /** Proposed name without extension. */
  suggestedName: string;
}

export interface ExportDestination {
  id: string;
  path: string;
}

export interface ExportCapabilities {
  /** Only formats whose encoder was verified on this machine. */
  animationFormats: AnimationFormatId[];
}

export type ExportStage = 'rendering' | 'finalizing';

export interface ExportProgress {
  stage: ExportStage;
  /** Frames written so far across all scenes. */
  current: number;
  total: number;
  /** Scene being exported, `null` while finalizing. */
  sceneName: string | null;
}

export interface ExportResult {
  /** File, or directory for multi-file exports. */
  outputPath: string;
  fileCount: number;
  /** Set when something non-fatal needs attention, e.g. temporary files that could not be removed. */
  warning?: string;
}

export function destinationKindOf({ kind, scope }: Pick<DestinationQuery, 'kind' | 'scope'>): DestinationKind {
  if (kind === 'frames') {
    return 'directory';
  }
  return kind === 'animation' && scope === 'all' ? 'directory' : 'file';
}
