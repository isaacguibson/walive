import { describe, expect, it } from 'vitest';
import {
  buildDestinationQuery,
  defaultSettings,
  planRequest,
  summarize,
  withDimension,
  type ExportContext,
  type ExportSettings
} from '../../src/renderer/state/exportSettings';

const context: ExportContext = {
  projectName: 'My Film',
  sceneName: 'Opening',
  canvasWidth: 1920,
  canvasHeight: 1080,
  frameCount: 10,
  activeFrameId: 'f3',
  activeFrameNumber: 3,
  sceneFps: 24
};

const settings = (patch: Partial<ExportSettings> = {}): ExportSettings => ({ ...defaultSettings(context), ...patch });

function requestOf(patch: Partial<ExportSettings>) {
  const plan = planRequest(settings(patch), context);
  if (plan.error !== null) {
    throw new Error(plan.error);
  }
  return plan.build('dest', false);
}

const errorOf = (patch: Partial<ExportSettings>): string | null => planRequest(settings(patch), context).error;

describe('export settings', () => {
  it('exports the current frame by default, referring to the frame by id', () => {
    expect(requestOf({})).toEqual({ destinationId: 'dest', overwrite: false, kind: 'current-frame', frameId: 'f3' });
  });

  it('builds a frame sequence request with the chosen range and resolution', () => {
    expect(requestOf({ kind: 'frames-zip', customRange: true, rangeStart: '2', rangeEnd: '5', customResolution: true, width: '960', height: '540' })).toEqual({
      destinationId: 'dest',
      overwrite: false,
      kind: 'frames-zip',
      scope: 'active',
      range: { start: 2, end: 5 },
      resolution: { mode: 'custom', width: 960, height: 540 }
    });
  });

  it('ignores the custom range when exporting every scene', () => {
    expect(requestOf({ kind: 'frames', scope: 'all', customRange: true, rangeStart: '9', rangeEnd: '1' })).toMatchObject({ scope: 'all', range: null });
  });

  it('builds animation requests for the scene frame rate or a custom one', () => {
    const base = { kind: 'animation', format: 'gif', transparentBackground: true, loop: true } as const;
    expect(requestOf(base)).toMatchObject({ fps: 24, background: { type: 'transparent' }, loop: true, format: 'gif', quality: 'balanced' });
    expect(requestOf({ ...base, customFps: true, fps: '60', transparentBackground: false, color: '#102030', loop: false })).toMatchObject({
      fps: 60,
      background: { type: 'color', color: '#102030' },
      loop: false
    });
  });

  it('never sends transparency or looping for MP4', () => {
    expect(requestOf({ kind: 'animation', format: 'mp4', transparentBackground: true, loop: true, color: '#abcdef' })).toMatchObject({
      format: 'mp4',
      background: { type: 'color', color: '#abcdef' },
      loop: false
    });
  });

  it.each([
    ['a missing first frame', { customRange: true, rangeStart: '', rangeEnd: '4' }, /first frame/],
    ['a first frame below 1', { customRange: true, rangeStart: '0', rangeEnd: '4' }, /first frame/],
    ['a last frame past the end', { customRange: true, rangeStart: '1', rangeEnd: '11' }, /last frame must be a number between 1 and 10/],
    ['a decimal frame', { customRange: true, rangeStart: '1.5', rangeEnd: '4' }, /first frame/],
    ['a reversed range', { customRange: true, rangeStart: '5', rangeEnd: '2' }, /cannot come after/],
    ['an empty width', { customResolution: true, width: '', height: '10' }, /whole numbers/],
    ['a zero height', { customResolution: true, width: '10', height: '0' }, /whole numbers/],
    ['a negative width', { customResolution: true, width: '-4', height: '10' }, /whole numbers/],
    ['a huge width', { customResolution: true, width: '9000', height: '10' }, /cannot exceed 8192/],
    ['too many pixels', { customResolution: true, width: '8000', height: '8000' }, /too large/],
    ['a zero frame rate', { customFps: true, fps: '0' }, /between 1 and 120/],
    ['a frame rate above the limit', { customFps: true, fps: '121' }, /between 1 and 120/],
    ['a decimal frame rate', { customFps: true, fps: '24.5' }, /between 1 and 120/]
  ] satisfies Array<[string, Partial<ExportSettings>, RegExp]>)('rejects %s', (_name, patch, message) => {
    expect(errorOf({ kind: 'animation', ...patch })).toMatch(message);
  });

  it('only checks what the chosen export type uses', () => {
    expect(errorOf({ kind: 'current-frame', customRange: true, rangeStart: '0', customResolution: true, width: '0' })).toBeNull();
    expect(errorOf({ kind: 'frames', customFps: true, fps: '0' })).toBeNull();
  });

  it('keeps the aspect ratio while a dimension changes, unless it is unlocked', () => {
    const custom = settings({ customResolution: true });
    expect(withDimension(custom, context, 'width', '960')).toMatchObject({ width: '960', height: '540' });
    expect(withDimension(custom, context, 'height', '270')).toMatchObject({ width: '480', height: '270' });
    expect(withDimension(custom, context, 'width', '')).toMatchObject({ width: '', height: '1080' });
    expect(withDimension({ ...custom, keepAspectRatio: false }, context, 'width', '100')).toMatchObject({ width: '100', height: '1080' });
  });

  it('proposes file names from the scene and frame, or the project for every scene', () => {
    expect(buildDestinationQuery(settings(), context)).toEqual({ kind: 'current-frame', scope: 'active', format: 'mp4', suggestedName: 'Opening_frame_0003' });
    expect(buildDestinationQuery(settings({ kind: 'animation', format: 'gif' }), context)).toEqual({
      kind: 'animation',
      scope: 'active',
      format: 'gif',
      suggestedName: 'Opening'
    });
    expect(buildDestinationQuery(settings({ kind: 'frames-zip', scope: 'all' }), context).suggestedName).toBe('My Film');
  });

  it('summarizes the choices that will be exported', () => {
    expect(Object.fromEntries(summarize(settings({ kind: 'animation', format: 'gif', customRange: true, rangeStart: '2', rangeEnd: '4', customFps: true, fps: '30' }), context))).toEqual({
      Export: 'Animation (GIF)',
      Scenes: 'Opening',
      Frames: '2 to 4',
      Resolution: '1920 × 1080 px (original)',
      'Frame rate': '30 FPS',
      Background: 'Transparent'
    });
    expect(Object.fromEntries(summarize(settings(), context))).toEqual({
      Export: 'Current Frame (PNG)',
      Frame: '3 of 10 in Opening',
      Resolution: '1920 × 1080 px (original)'
    });
  });
});
