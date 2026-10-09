import { getPixel } from '@editor/drawing/raster';
import { FrameClipboardStore } from '@editor/animation/clipboard';
import { EditorSession, type EditorSessionOptions } from '@editor/editorSession';
import type { Frame, Rgba } from '@editor/model';
import type { PlaybackClock } from '@editor/playback/playbackController';

export const SIZE = 16;

/** Deterministic clock: timers only fire when `advance` is called. */
export class FakeClock implements PlaybackClock {
  private time = 0;
  private nextHandle = 1;
  private timers: { handle: number; at: number; callback: () => void }[] = [];

  now(): number {
    return this.time;
  }

  setTimeout(callback: () => void, delayMs: number): unknown {
    const handle = this.nextHandle;
    this.nextHandle += 1;
    this.timers.push({ handle, at: this.time + delayMs, callback });
    return handle;
  }

  clearTimeout(handle: unknown): void {
    this.timers = this.timers.filter((timer) => timer.handle !== handle);
  }

  get pending(): number {
    return this.timers.length;
  }

  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const due = this.timers.filter((timer) => timer.at <= end).sort((a, b) => a.at - b.at)[0];
      if (due === undefined) {
        break;
      }
      this.timers = this.timers.filter((timer) => timer !== due);
      this.time = Math.max(this.time, due.at);
      due.callback();
    }
    this.time = end;
  }
}

export function makeSession(options: Partial<EditorSessionOptions> = {}): EditorSession {
  return new EditorSession({
    width: SIZE,
    height: SIZE,
    clipboard: new FrameClipboardStore(),
    ...options
  });
}

export function activeFrame(session: EditorSession): Frame {
  return session.getSnapshot().activeFrame;
}

/** Pixel of the top layer of the frame at `frameIndex` (default: the active frame). */
export function pixelAt(session: EditorSession, x: number, y: number, frameIndex?: number, layerIndex = 0): Rgba {
  const snapshot = session.getSnapshot();
  const frame = frameIndex === undefined ? snapshot.activeFrame : (snapshot.frames[frameIndex] as Frame);
  const layer = frame.layers[layerIndex];
  if (layer === undefined) {
    throw new Error('Layer not found');
  }
  return getPixel(layer.drawing, x, y);
}

export function click(session: EditorSession, x: number, y: number, pointerId = 1): void {
  session.pointerDown({ x, y, pointerId, buttons: 1 });
  session.pointerUp({ x, y, pointerId, buttons: 0 });
}

export function drag(session: EditorSession, from: [number, number], to: [number, number], pointerId = 1): void {
  session.pointerDown({ x: from[0], y: from[1], pointerId, buttons: 1 });
  session.pointerMove({ x: to[0], y: to[1], pointerId, buttons: 1 });
  session.pointerUp({ x: to[0], y: to[1], pointerId, buttons: 0 });
}

export const RED: Rgba = [255, 0, 0, 255];
export const TRANSPARENT: Rgba = [0, 0, 0, 0];

/** Paints a red dot with the brush at the given pixel. */
export function paintRed(session: EditorSession, x = 5.5, y = 5.5): void {
  session.selectTool('brush');
  session.setColor('#ff0000');
  session.setBrushSize(4);
  click(session, x, y);
}
