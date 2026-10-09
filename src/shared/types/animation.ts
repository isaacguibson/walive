/** Limits shared by the editor and the persistence layer. */
export const ANIMATION_LIMITS = {
  maxFrames: 10_000,
  maxLayersPerFrame: 256,
  maxLayerNameLength: 50
} as const;

/** Transport/storage representation of one layer. */
export interface AnimationLayerData {
  id: string;
  name: string;
  visible: boolean;
  /** Raw non-premultiplied RGBA pixels (`width * height * 4` bytes), or `null` for a blank layer. */
  pixels: Uint8Array | null;
}

export interface AnimationFrameData {
  id: string;
  /** Top-most layer first. */
  layers: AnimationLayerData[];
}

/** Complete animation content of a project, as exchanged with Project Management. */
export interface AnimationDocument {
  width: number;
  height: number;
  frames: AnimationFrameData[];
  /** Optional for backwards compatibility. The designated visual reference frame. */
  manualReferenceFrameId?: string | null;
}
