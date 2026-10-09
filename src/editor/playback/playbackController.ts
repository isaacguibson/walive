import { parseFps } from '../validation';

/** Time source used by the playback controller; replaceable so playback can be tested deterministically. */
export interface PlaybackClock {
  now(): number;
  setTimeout(callback: () => void, delayMs: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const browserClock: PlaybackClock = {
  now: () => performance.now(),
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

/** What playback needs from the animation. It reads the live data; it never keeps a copy. */
export interface PlaybackHost {
  getFrameIds(): readonly string[];
  getActiveFrameId(): string | null;
  selectFrame(frameId: string): void;
  getFps(): number;
  isLoop(): boolean;
}

/**
 * Index of the frame that follows `index`, or `null` when playback must stop
 * (last frame reached and looping is off).
 */
export function nextPlaybackIndex(frameCount: number, index: number, loop: boolean): number | null {
  if (frameCount <= 0) {
    return null;
  }
  if (index < 0) {
    return 0;
  }
  const next = index + 1;
  if (next < frameCount) {
    return next;
  }
  return loop ? 0 : null;
}

/**
 * Sequences the frames at the configured FPS by moving the active frame of the
 * animation, so the canvas, timeline and layer panel follow through the normal
 * editor state. It is independent of any UI component (HU_00004 §53).
 */
export class PlaybackController {
  private playing = false;
  private handle: unknown = null;
  private startedAt = 0;
  private ticks = 0;
  private scheduledFps = 0;

  constructor(
    private readonly host: PlaybackHost,
    private readonly onChange: () => void,
    private readonly clock: PlaybackClock = browserClock
  ) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Starts playback. Returns `false` when the FPS is invalid or there is nothing to play. */
  start(): boolean {
    if (this.playing) {
      return true;
    }
    const ids = this.host.getFrameIds();
    if (ids.length === 0 || parseFps(this.host.getFps()) === null) {
      return false;
    }
    const activeIndex = ids.indexOf(this.host.getActiveFrameId() ?? '');
    // Starting from the end of a non-looping animation plays it again from the beginning.
    if (!this.host.isLoop() && ids.length > 1 && activeIndex === ids.length - 1) {
      this.host.selectFrame(ids[0] as string);
    }
    this.playing = true;
    this.resetTimeline();
    this.schedule();
    this.onChange();
    return true;
  }

  stop(): void {
    if (!this.playing) {
      return;
    }
    this.playing = false;
    this.cancelTimer();
    this.onChange();
  }

  dispose(): void {
    this.playing = false;
    this.cancelTimer();
  }

  private resetTimeline(): void {
    this.startedAt = this.clock.now();
    this.ticks = 0;
    this.scheduledFps = this.host.getFps();
  }

  private schedule(): void {
    const fps = this.host.getFps();
    if (parseFps(fps) === null) {
      this.stop();
      return;
    }
    if (fps !== this.scheduledFps) {
      this.resetTimeline();
    }
    const interval = 1000 / fps;
    const now = this.clock.now();
    let target = this.startedAt + (this.ticks + 1) * interval;
    // Running late by more than a frame (busy renderer): do not fast-forward to catch up.
    if (now - target > interval) {
      this.resetTimeline();
      target = this.startedAt + interval;
    }
    this.handle = this.clock.setTimeout(() => this.tick(), Math.max(0, target - now));
  }

  private tick(): void {
    this.handle = null;
    if (!this.playing) {
      return;
    }
    this.ticks += 1;
    const ids = this.host.getFrameIds();
    const current = ids.indexOf(this.host.getActiveFrameId() ?? '');
    const next = nextPlaybackIndex(ids.length, current, this.host.isLoop());
    if (next === null) {
      this.stop();
      return;
    }
    this.host.selectFrame(ids[next] as string);
    this.schedule();
  }

  private cancelTimer(): void {
    if (this.handle !== null) {
      this.clock.clearTimeout(this.handle);
      this.handle = null;
    }
  }
}
