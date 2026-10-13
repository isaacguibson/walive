import type { AnimationFormatId, ExportBackground, QualityPreset } from '@shared/types/export';

export interface EncoderSettings {
  /** Where the encoder writes. It never is the final destination: the export stages its output first. */
  outputPath: string;
  width: number;
  height: number;
  fps: number;
  background: ExportBackground;
  quality: QualityPreset;
  /** GIF only. */
  loop: boolean;
  /** Aborting must stop the encoder as soon as possible. */
  signal: AbortSignal;
}

/** Receives rendered frames in timeline order and produces one animation file. */
export interface AnimationEncoder {
  /** `rgba` is non-premultiplied and already composited on the chosen background, if any. */
  addFrame(rgba: Uint8Array): Promise<void>;
  finish(): Promise<void>;
  /** Releases everything without producing a valid file. Safe to call after a failure. */
  abort(): Promise<void>;
}

/** A video or animated image format. Adding a format means adding one of these to the registry. */
export interface AnimationFormat {
  id: AnimationFormatId;
  extension: string;
  /** Whether the encoder works on this machine. Only available formats are offered to the user. */
  isAvailable(): Promise<boolean>;
  createEncoder(settings: EncoderSettings): Promise<AnimationEncoder>;
}
