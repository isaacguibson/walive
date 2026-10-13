import { spawn, type ChildProcessByStdio } from 'node:child_process';
import { once } from 'node:events';
import type { Readable, Writable } from 'node:stream';
import type { QualityPreset } from '@shared/types/export';
import type { AnimationEncoder, AnimationFormat, EncoderSettings } from './animationFormat';
import { AppError } from '../errors';

/** Constant rate factor and encoder speed: lower CRF and slower presets give better, larger files. */
const QUALITY: Record<QualityPreset, { crf: number; preset: string }> = {
  low: { crf: 28, preset: 'veryfast' },
  balanced: { crf: 23, preset: 'medium' },
  high: { crf: 18, preset: 'slow' }
};

const PROBE_TIMEOUT_MS = 10_000;
const STDERR_TAIL_LENGTH = 2000;

type Ffmpeg = ChildProcessByStdio<Writable, null, Readable>;

export function buildFfmpegArgs(settings: EncoderSettings): string[] {
  const { crf, preset } = QUALITY[settings.quality];
  const pad = settings.background.type === 'color' ? settings.background.color.replace('#', '') : 'ffffff';
  return [
    '-hide_banner',
    '-loglevel', 'error',
    '-y',
    '-f', 'rawvideo',
    '-pix_fmt', 'rgba',
    '-s', `${settings.width}x${settings.height}`,
    '-framerate', String(settings.fps),
    '-i', 'pipe:0',
    // H.264 needs even dimensions: pad by at most one pixel with the background color.
    '-vf', `pad=ceil(iw/2)*2:ceil(ih/2)*2:0:0:color=0x${pad},scale=out_color_matrix=bt709:out_range=tv,format=yuv420p`,
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', String(crf),
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-movflags', '+faststart',
    '-an',
    '-f', 'mp4',
    settings.outputPath
  ];
}

function startFailure(error: Error): AppError {
  const unavailable = 'code' in error && (error.code === 'ENOENT' || error.code === 'EACCES');
  return unavailable
    ? new AppError('EXPORT_UNSUPPORTED', 'The MP4 encoder is not available on this system.', { cause: error })
    : new AppError('EXPORT_FAILED', 'The video encoder could not be started.', { cause: error });
}

class FfmpegEncoder implements AnimationEncoder {
  private stderr = '';
  private spawnError: Error | null = null;
  private readonly exited: Promise<number>;

  constructor(private readonly child: Ffmpeg) {
    child.stderr.on('data', (chunk: Buffer) => {
      this.stderr = (this.stderr + chunk.toString()).slice(-STDERR_TAIL_LENGTH);
    });
    // Write failures surface through the exit code, which carries the real reason.
    child.stdin.on('error', () => undefined);
    this.exited = new Promise((resolve) => {
      child.once('error', (error) => {
        this.spawnError = error;
        resolve(-1);
      });
      child.once('close', (code) => resolve(code ?? -1));
    });
  }

  async addFrame(rgba: Uint8Array): Promise<void> {
    const { stdin } = this.child;
    if (stdin.write(rgba)) {
      return;
    }
    // Wait for the pipe to drain, but stop waiting if the encoder dies.
    const drained = once(stdin, 'drain').then(() => 'drained' as const, () => -1);
    const outcome = await Promise.race([drained, this.exited]);
    if (outcome !== 'drained') {
      throw await this.failure();
    }
  }

  async finish(): Promise<void> {
    this.child.stdin.end();
    if ((await this.exited) !== 0) {
      throw await this.failure();
    }
  }

  async abort(): Promise<void> {
    this.child.kill('SIGKILL');
    await this.exited;
  }

  private async failure(): Promise<AppError> {
    await this.exited;
    return this.spawnError
      ? startFailure(this.spawnError)
      : new AppError('EXPORT_FAILED', 'The video encoder stopped unexpectedly.', { cause: new Error(this.stderr) });
  }
}

/** Lists the encoders ffmpeg was built with; resolves to an empty string when it cannot run. */
function listEncoders(ffmpegPath: string): Promise<string> {
  return new Promise((resolve) => {
    const child = spawn(ffmpegPath, ['-hide_banner', '-encoders'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: PROBE_TIMEOUT_MS });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString();
    });
    child.once('error', () => resolve(''));
    child.once('close', () => resolve(output));
  });
}

/** MP4 (H.264) through an ffmpeg binary; `ffmpegPath` is null when none is bundled. */
export function createMp4Format(ffmpegPath: string | null): AnimationFormat {
  return {
    id: 'mp4',
    extension: 'mp4',
    isAvailable: async () => ffmpegPath !== null && (await listEncoders(ffmpegPath)).includes('libx264'),
    async createEncoder(settings) {
      if (ffmpegPath === null) {
        throw new AppError('EXPORT_UNSUPPORTED', 'The MP4 encoder is not available on this system.');
      }
      const child = spawn(ffmpegPath, buildFfmpegArgs(settings), { stdio: ['pipe', 'ignore', 'pipe'] });
      const encoder = new FfmpegEncoder(child);
      settings.signal.addEventListener('abort', () => void encoder.abort(), { once: true });
      return encoder;
    }
  };
}
