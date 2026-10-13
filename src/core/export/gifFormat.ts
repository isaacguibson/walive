import { open } from 'node:fs/promises';
import type { AnimationEncoder, AnimationFormat, EncoderSettings } from './animationFormat';
import { writeFully } from './files';
import { GifEncoder } from './gif';
import type { QualityPreset } from '@shared/types/export';

/** GIF is limited to 256 colors; fewer colors give smaller files. */
const PALETTE_SIZE: Record<QualityPreset, number> = { low: 64, balanced: 128, high: 256 };

const CENTISECONDS_PER_SECOND = 100;

/**
 * Delay of each frame in hundredths of a second. GIF cannot express most frame rates exactly,
 * so the rounding error is carried over to keep the total duration right.
 */
export function createGifDelays(fps: number): () => number {
  let frame = 0;
  let elapsed = 0;
  return () => {
    frame += 1;
    const delay = Math.max(1, Math.round((frame * CENTISECONDS_PER_SECOND) / fps) - elapsed);
    elapsed += delay;
    return delay;
  };
}

async function createEncoder(settings: EncoderSettings): Promise<AnimationEncoder> {
  const handle = await open(settings.outputPath, 'w');
  const nextDelay = createGifDelays(settings.fps);
  const gif = new GifEncoder(
    {
      width: settings.width,
      height: settings.height,
      loop: settings.loop,
      maxColors: PALETTE_SIZE[settings.quality],
      transparent: settings.background.type === 'transparent'
    },
    (data) => writeFully(handle, data)
  );
  return {
    addFrame: (rgba) => gif.addFrame(rgba, nextDelay()),
    finish: async () => {
      await gif.finish();
      await handle.close();
    },
    abort: () => handle.close().catch(() => undefined)
  };
}

export const gifFormat: AnimationFormat = {
  id: 'gif',
  extension: 'gif',
  isAvailable: async () => true,
  createEncoder
};
