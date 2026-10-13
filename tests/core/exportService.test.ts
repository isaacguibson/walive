import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import ffmpegStatic from 'ffmpeg-static';
import { describe, expect, it } from 'vitest';
import { gifFormat } from '@core/export/gifFormat';
import { createMp4Format } from '@core/export/mp4Format';
import { ExportService, type ExportRunOptions, type ExportScenes } from '@core/export/exportService';
import { ProjectService } from '@core/project/projectService';
import type { AnimationExport, ExportProgress, ExportRequest, FrameSequenceExport } from '@shared/types/export';
import { decodeGif, decodePng, pixelAt, readZip } from '../helpers/exportDecoders';
import { BLUE, GREEN, HEIGHT, RED, WIDTH, createExportFixture, frame, solid } from '../helpers/exportProject';
import { makeTempDir } from '../helpers/tempDir';

const run = promisify(execFile);
const ffmpegPath: string | null = ffmpegStatic;
const hasMp4 = await createMp4Format(ffmpegPath).isAvailable();

const common = { destinationId: 'dest', overwrite: false };
const frames = (overrides: Partial<FrameSequenceExport> = {}): FrameSequenceExport => ({
  ...common,
  kind: 'frames',
  scope: 'active',
  range: null,
  resolution: { mode: 'original' },
  ...overrides
});
const zip = (overrides: Partial<FrameSequenceExport> = {}): FrameSequenceExport => ({ ...frames(overrides), kind: 'frames-zip' });
const animation = (overrides: Partial<AnimationExport> = {}): AnimationExport => ({
  ...common,
  kind: 'animation',
  format: 'gif',
  scope: 'active',
  range: null,
  resolution: { mode: 'original' },
  fps: 24,
  background: { type: 'transparent' },
  quality: 'balanced',
  loop: true,
  ...overrides
});

const idle: ExportRunOptions = { signal: new AbortController().signal, onProgress: () => undefined };

function serviceFor(scenes: ExportScenes, ffmpeg: string | null = ffmpegPath): ExportService {
  return new ExportService(scenes, [gifFormat, createMp4Format(ffmpeg)]);
}

async function setup() {
  const fixture = await createExportFixture();
  return { ...fixture, service: serviceFor(fixture.projects.scenes), scenes: fixture.projects.scenes };
}

const listing = async (directory: string): Promise<string[]> => (await fs.readdir(directory)).sort();
const readPng = async (file: string) => decodePng(await fs.readFile(file));

/** Hash of every file below `directory`, to prove nothing changed. */
async function snapshot(directory: string): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  for (const entry of await fs.readdir(directory, { recursive: true, withFileTypes: true })) {
    if (entry.isFile()) {
      const file = path.join(entry.parentPath, entry.name);
      result.set(path.relative(directory, file), createHash('sha1').update(await fs.readFile(file)).digest('hex'));
    }
  }
  return result;
}

describe('single frame export', () => {
  it('writes the visible artwork of the selected frame as a PNG with the canvas size', async () => {
    const { service, destination } = await setup();
    const target = path.join(destination, 'frame.png');
    const result = await service.run({ ...common, kind: 'current-frame', frameId: 'f2' }, target, idle);
    expect(result).toEqual({ outputPath: target, fileCount: 1 });
    const image = await readPng(target);
    expect([image.width, image.height]).toEqual([WIDTH, HEIGHT]);
    // The hidden blue layer is left out.
    expect(pixelAt(image, 3, 3)).toEqual(GREEN);
    expect(await listing(destination)).toEqual(['frame.png']);
  });

  it('adds the extension when the chosen name has none and keeps transparency', async () => {
    const { service, destination } = await setup();
    const result = await service.run({ ...common, kind: 'current-frame', frameId: 'f3' }, path.join(destination, 'blank'), idle);
    expect(result.outputPath).toBe(path.join(destination, 'blank.png'));
    expect(pixelAt(await readPng(result.outputPath), 2, 2)).toEqual([0, 0, 0, 0]);
  });

  it('stacks layers with the first one on top', async () => {
    const { service, destination } = await setup();
    const target = path.join(destination, 'f1.png');
    await service.run({ ...common, kind: 'current-frame', frameId: 'f1' }, target, idle);
    const image = await readPng(target);
    expect(pixelAt(image, 1, 1)).toEqual(BLUE);
    expect(pixelAt(image, 0, 0)).toEqual(RED);
  });

  it('renders Bézier curves like the editor and nothing else', async () => {
    const { service, destination } = await setup();
    const target = path.join(destination, 'curve.png');
    await service.run({ ...common, kind: 'current-frame', frameId: 'f4' }, target, idle);
    const image = await readPng(target);
    expect(pixelAt(image, 4, 3)).toEqual(RED);
    expect(pixelAt(image, 7, 0)).toEqual([0, 0, 0, 0]);
  });

  it('refuses a frame that is not in the saved scene', async () => {
    const { service, destination } = await setup();
    await expect(service.run({ ...common, kind: 'current-frame', frameId: 'nope' }, path.join(destination, 'x.png'), idle)).rejects.toMatchObject({
      code: 'INVALID_EXPORT'
    });
    expect(await listing(destination)).toEqual([]);
  });

  it('exports a scene that was never saved as one transparent frame', async () => {
    const projects = new ProjectService();
    await projects.createProject('Fresh', await makeTempDir(), { width: 3, height: 2, keepAspectRatio: false });
    const destination = await makeTempDir();
    const target = path.join(destination, 'fresh.png');
    await serviceFor(projects.scenes).run({ ...common, kind: 'current-frame', frameId: 'blank' }, target, idle);
    const image = await readPng(target);
    expect([image.width, image.height, ...image.rgba]).toEqual([3, 2, ...new Array(24).fill(0)]);
  });
});

describe('PNG sequence export', () => {
  it('writes every frame in timeline order with sortable names', async () => {
    const { service, destination } = await setup();
    const result = await service.run(frames(), destination, idle);
    expect(result).toEqual({ outputPath: destination, fileCount: 4 });
    expect(await listing(destination)).toEqual(['frame_0001.png', 'frame_0002.png', 'frame_0003.png', 'frame_0004.png']);
    expect(pixelAt(await readPng(path.join(destination, 'frame_0001.png')), 1, 1)).toEqual(BLUE);
    expect(pixelAt(await readPng(path.join(destination, 'frame_0003.png')), 1, 1)).toEqual([0, 0, 0, 0]);
  });

  it('exports only the chosen range, keeping the real frame numbers', async () => {
    const { service, destination } = await setup();
    await service.run(frames({ range: { start: 2, end: 3 } }), destination, idle);
    expect(await listing(destination)).toEqual(['frame_0002.png', 'frame_0003.png']);
  });

  it('rejects a range that goes past the last frame', async () => {
    const { service, destination } = await setup();
    await expect(service.run(frames({ range: { start: 2, end: 5 } }), destination, idle)).rejects.toMatchObject({ code: 'INVALID_EXPORT' });
    expect(await listing(destination)).toEqual([]);
  });

  it('renders at a custom resolution instead of resizing a bitmap of the canvas size', async () => {
    const { service, destination } = await setup();
    await service.run(frames({ range: { start: 1, end: 1 }, resolution: { mode: 'custom', width: 16, height: 12 } }), destination, idle);
    const image = await readPng(path.join(destination, 'frame_0001.png'));
    expect([image.width, image.height]).toEqual([16, 12]);
    expect(pixelAt(image, 2, 2)).toEqual(BLUE);
    expect(pixelAt(image, 4, 2)).toEqual(RED);

    const small = await makeTempDir();
    await service.run(frames({ range: { start: 1, end: 1 }, resolution: { mode: 'custom', width: 4, height: 3 } }), small, idle);
    expect((await readPng(path.join(small, 'frame_0001.png'))).width).toBe(4);
  });

  it('puts every scene in its own folder, with unique names for colliding scene names', async () => {
    const { service, destination } = await setup();
    const result = await service.run(frames({ scope: 'all' }), destination, idle);
    expect(result.fileCount).toBe(6);
    expect(await listing(destination)).toEqual(['A_B', 'A_B_2']);
    expect(await listing(path.join(destination, 'A_B'))).toHaveLength(4);
    expect(await listing(path.join(destination, 'A_B_2'))).toEqual(['frame_0001.png', 'frame_0002.png']);
    expect(pixelAt(await readPng(path.join(destination, 'A_B_2', 'frame_0001.png')), 0, 0)).toEqual(BLUE);
  });
});

describe('ZIP export', () => {
  it('packs the frames of the active scene in order', async () => {
    const { service, destination } = await setup();
    const result = await service.run(zip(), path.join(destination, 'scene.zip'), idle);
    expect(result).toEqual({ outputPath: path.join(destination, 'scene.zip'), fileCount: 1 });
    const entries = readZip(await fs.readFile(path.join(destination, 'scene.zip')));
    expect(entries.map((entry) => entry.name)).toEqual(['frame_0001.png', 'frame_0002.png', 'frame_0003.png', 'frame_0004.png']);
    expect(pixelAt(decodePng(entries[0]?.data ?? Buffer.alloc(0)), 1, 1)).toEqual(BLUE);
    expect(await listing(destination)).toEqual(['scene.zip']);
  });

  it('keeps one folder per scene inside the archive', async () => {
    const { service, destination } = await setup();
    await service.run(zip({ scope: 'all' }), path.join(destination, 'all'), idle);
    const entries = readZip(await fs.readFile(path.join(destination, 'all.zip')));
    expect(entries.map((entry) => entry.name)).toEqual([
      'A_B/frame_0001.png',
      'A_B/frame_0002.png',
      'A_B/frame_0003.png',
      'A_B/frame_0004.png',
      'A_B_2/frame_0001.png',
      'A_B_2/frame_0002.png'
    ]);
  });
});

describe('animation export', () => {
  it('writes a GIF with the frames in order, timed by the chosen frame rate', async () => {
    const { service, destination } = await setup();
    const target = path.join(destination, 'scene.gif');
    await service.run(animation(), target, idle);
    const gif = decodeGif(await fs.readFile(target));
    expect(gif.frames).toHaveLength(4);
    expect([gif.width, gif.height]).toEqual([WIDTH, HEIGHT]);
    expect(gif.frames.map((item) => item.delay)).toEqual([4, 4, 5, 4]);
    expect(gif.loopCount).toBe(0);
    expect(Array.from(gif.frames[1]?.rgba.subarray(0, 4) ?? [])).toEqual(GREEN);
    // Transparent artwork stays transparent.
    expect(gif.frames[2]?.rgba.every((value) => value === 0)).toBe(true);
  });

  it('does not loop when looping is off and uses the chosen background instead of transparency', async () => {
    const { service, destination } = await setup();
    const target = path.join(destination, 'scene.gif');
    await service.run(animation({ loop: false, background: { type: 'color', color: '#ffffff' }, range: { start: 3, end: 3 } }), target, idle);
    const gif = decodeGif(await fs.readFile(target));
    expect(gif.loopCount).toBeNull();
    expect(gif.frames).toHaveLength(1);
    expect(Array.from(gif.frames[0]?.rgba.subarray(0, 4) ?? [])).toEqual([255, 255, 255, 255]);
  });

  it('writes one animation per scene, named after the scene', async () => {
    const { service, destination } = await setup();
    const result = await service.run(animation({ scope: 'all', resolution: { mode: 'custom', width: 4, height: 3 } }), destination, idle);
    expect(result.fileCount).toBe(2);
    expect(await listing(destination)).toEqual(['A_B.gif', 'A_B_2.gif']);
    const second = decodeGif(await fs.readFile(path.join(destination, 'A_B_2.gif')));
    expect([second.frames.length, second.width, second.height]).toEqual([2, 4, 3]);
  });

  const probe = async (file: string): Promise<string> => {
    try {
      await run(ffmpegPath as string, ['-hide_banner', '-i', file]);
      return '';
    } catch (error) {
      return (error as { stderr: string }).stderr;
    }
  };
  const decodeFirstFrame = async (file: string): Promise<Buffer> =>
    (await run(ffmpegPath as string, ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-'], { encoding: 'buffer' })).stdout;

  it.skipIf(!hasMp4)('writes an H.264 MP4 whose duration is the frame count divided by the frame rate', async () => {
    const { service, destination } = await setup();
    const target = path.join(destination, 'scene.mp4');
    await service.run(animation({ format: 'mp4', fps: 4, background: { type: 'color', color: '#ffffff' } }), target, idle);
    const info = await probe(target);
    expect(info).toMatch(/Video: h264/);
    expect(info).toMatch(/, 8x6[, ]/);
    const [, hours, minutes, seconds] = /Duration: (\d+):(\d+):([\d.]+)/.exec(info) ?? [];
    expect(Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds)).toBeCloseTo(1, 1);
    expect(await listing(destination)).toEqual(['scene.mp4']);
  });

  it.skipIf(!hasMp4)('composites transparent artwork over the chosen background color', async () => {
    const { service, destination } = await setup();
    const target = path.join(destination, 'red.mp4');
    await service.run(animation({ format: 'mp4', fps: 1, background: { type: 'color', color: '#ff0000' }, range: { start: 3, end: 3 } }), target, idle);
    const [red, green, blue] = await decodeFirstFrame(target);
    expect(red).toBeGreaterThan(220);
    expect(green).toBeLessThan(40);
    expect(blue).toBeLessThan(40);
  });

  it.skipIf(!hasMp4)('pads odd custom sizes to the even size H.264 requires', async () => {
    const { service, destination } = await setup();
    const target = path.join(destination, 'odd.mp4');
    await service.run(animation({ format: 'mp4', background: { type: 'color', color: '#000000' }, resolution: { mode: 'custom', width: 7, height: 5 } }), target, idle);
    expect(await probe(target)).toMatch(/, 8x6[, ]/);
  });

  it.skipIf(!hasMp4)('produces GIF and MP4 files that independent decoders accept', async () => {
    const { service, destination } = await setup();
    await service.run(animation(), path.join(destination, 'check.gif'), idle);
    const { stderr } = await run(ffmpegPath as string, ['-hide_banner', '-v', 'error', '-i', path.join(destination, 'check.gif'), '-f', 'null', '-']);
    expect(stderr).toBe('');
  });

  it('reports a missing MP4 encoder instead of failing half way', async () => {
    const { projects, destination } = await setup();
    const service = serviceFor(projects.scenes, null);
    expect(await service.getCapabilities()).toEqual({ animationFormats: ['gif'] });
    await expect(service.run(animation({ format: 'mp4', background: { type: 'color', color: '#ffffff' } }), path.join(destination, 'x.mp4'), idle)).rejects.toMatchObject({
      code: 'EXPORT_UNSUPPORTED'
    });
    const broken = serviceFor(projects.scenes, path.join(destination, 'missing-ffmpeg'));
    expect(await broken.getCapabilities()).toEqual({ animationFormats: ['gif'] });
    expect(await listing(destination)).toEqual([]);
  });

  it.skipIf(!hasMp4)('lists MP4 as available when the encoder works', async () => {
    const { service } = await setup();
    expect(await service.getCapabilities()).toEqual({ animationFormats: ['gif', 'mp4'] });
  });
});

describe('destination checks and conflicts', () => {
  it('never replaces an existing file unless that was approved', async () => {
    const { service, destination } = await setup();
    const target = path.join(destination, 'frame.png');
    await fs.writeFile(target, 'precious');
    const request: ExportRequest = { ...common, kind: 'current-frame', frameId: 'f1' };
    await expect(service.run(request, target, idle)).rejects.toMatchObject({ code: 'EXPORT_CONFLICT' });
    expect(await fs.readFile(target, 'utf8')).toBe('precious');
    expect(await listing(destination)).toEqual(['frame.png']);

    await service.run({ ...request, overwrite: true }, target, idle);
    expect((await readPng(target)).width).toBe(WIDTH);
    expect(await listing(destination)).toEqual(['frame.png']);
  });

  it('detects conflicts before rendering anything, naming the files', async () => {
    const { service, destination } = await setup();
    await fs.writeFile(path.join(destination, 'frame_0002.png'), 'old');
    await expect(service.run(frames(), destination, idle)).rejects.toThrowError(/frame_0002\.png/);
    expect(await listing(destination)).toEqual(['frame_0002.png']);

    await service.run(frames({ overwrite: true }), destination, idle);
    expect(await listing(destination)).toHaveLength(4);
    expect((await readPng(path.join(destination, 'frame_0002.png'))).width).toBe(WIDTH);
  });

  it('does not replace a folder with a file', async () => {
    const { service, destination } = await setup();
    await fs.mkdir(path.join(destination, 'scene.zip'));
    await expect(service.run(zip({ overwrite: true }), path.join(destination, 'scene.zip'), idle)).rejects.toMatchObject({ code: 'INVALID_EXPORT' });
  });

  it('reports destinations that do not exist', async () => {
    const { service, destination } = await setup();
    await expect(service.run(frames(), path.join(destination, 'missing'), idle)).rejects.toMatchObject({ code: 'INVALID_LOCATION' });
    await expect(service.run(zip(), path.join(destination, 'missing', 'a.zip'), idle)).rejects.toMatchObject({ code: 'INVALID_LOCATION' });
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() === 0)('reports folders that cannot be written to and leaves nothing behind', async () => {
    const { service, destination } = await setup();
    await fs.chmod(destination, 0o555);
    try {
      await expect(service.run(frames(), destination, idle)).rejects.toMatchObject({ code: 'LOCATION_NOT_WRITABLE' });
    } finally {
      await fs.chmod(destination, 0o755);
    }
    expect(await listing(destination)).toEqual([]);
  });
});

describe('progress and cancellation', () => {
  it('reports real progress for every frame, then the finalizing stage', async () => {
    const { service, destination } = await setup();
    const events: ExportProgress[] = [];
    await service.run(frames({ scope: 'all' }), destination, { signal: idle.signal, onProgress: (progress) => events.push(progress) });
    expect(events.map((event) => [event.stage, event.current, event.total, event.sceneName])).toEqual([
      ['rendering', 1, 6, 'A B'],
      ['rendering', 2, 6, 'A B'],
      ['rendering', 3, 6, 'A B'],
      ['rendering', 4, 6, 'A B'],
      ['rendering', 5, 6, 'A_B'],
      ['rendering', 6, 6, 'A_B'],
      ['finalizing', 6, 6, null]
    ]);
  });

  it('lets other work run between frames so the app stays responsive', async () => {
    const { service, destination } = await setup();
    let turned = true;
    await service.run(frames(), destination, {
      signal: idle.signal,
      onProgress: (progress) => {
        if (progress.stage === 'rendering') {
          expect(turned).toBe(true);
          turned = false;
          setImmediate(() => (turned = true));
        }
      }
    });
  });

  const cancelAfterFirstFrame = (): ExportRunOptions => {
    const controller = new AbortController();
    return { signal: controller.signal, onProgress: (progress) => progress.current === 1 && controller.abort() };
  };

  it('stops a PNG export and removes what was written', async () => {
    const { service, destination } = await setup();
    await expect(service.run(frames(), destination, cancelAfterFirstFrame())).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' });
    expect(await listing(destination)).toEqual([]);
  });

  it('stops archive creation and leaves no partial ZIP', async () => {
    const { service, destination } = await setup();
    await expect(service.run(zip(), path.join(destination, 'a.zip'), cancelAfterFirstFrame())).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' });
    expect(await listing(destination)).toEqual([]);
  });

  it('stops GIF encoding and leaves no partial file', async () => {
    const { service, destination } = await setup();
    await expect(service.run(animation(), path.join(destination, 'a.gif'), cancelAfterFirstFrame())).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' });
    expect(await listing(destination)).toEqual([]);
  });

  it.skipIf(!hasMp4)('terminates the video encoder and leaves no partial file', async () => {
    const { service, destination } = await setup();
    const request = animation({ format: 'mp4', background: { type: 'color', color: '#ffffff' }, scope: 'all' });
    await expect(service.run(request, destination, cancelAfterFirstFrame())).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' });
    expect(await listing(destination)).toEqual([]);
  });

  it('does not start when already cancelled', async () => {
    const { service, destination } = await setup();
    const controller = new AbortController();
    controller.abort();
    await expect(service.run(frames(), destination, { signal: controller.signal, onProgress: () => undefined })).rejects.toMatchObject({ code: 'EXPORT_CANCELLED' });
    expect(await listing(destination)).toEqual([]);
  });
});

describe('failures', () => {
  function failingAt(scenes: ExportScenes, failure: Error): ExportScenes {
    return {
      listScenes: () => scenes.listScenes(),
      openFrames: async (sceneId) => {
        const source = await scenes.openFrames(sceneId);
        return {
          ...source,
          readFrame: async (index) => {
            if (index === 2) {
              throw failure;
            }
            return source.readFrame(index);
          }
        };
      }
    };
  }

  it('keeps the previous file and leaves nothing behind when rendering fails', async () => {
    const { scenes, destination } = await setup();
    const target = path.join(destination, 'scene.zip');
    await fs.writeFile(target, 'previous');
    const service = serviceFor(failingAt(scenes, new Error('damaged layer')));
    await expect(service.run(zip({ overwrite: true }), target, idle)).rejects.toMatchObject({ code: 'EXPORT_FAILED' });
    expect(await fs.readFile(target, 'utf8')).toBe('previous');
    expect(await listing(destination)).toEqual(['scene.zip']);
  });

  it('explains a full disk without exposing technical details', async () => {
    const { scenes, destination } = await setup();
    const service = serviceFor(failingAt(scenes, Object.assign(new Error('write /secret/path'), { code: 'ENOSPC' })));
    const error = await service.run(frames(), destination, idle).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: 'EXPORT_FAILED', message: expect.stringMatching(/disk space/) });
    expect((error as Error).message).not.toContain('secret');
    expect(await listing(destination)).toEqual([]);
  });
});

describe('project safety', () => {
  it('does not modify the project or its scenes', async () => {
    const { service, projectPath, scenes, destination } = await setup();
    const before = await snapshot(projectPath);
    const registry = await scenes.listScenes();
    await service.run(frames({ scope: 'all' }), destination, idle);
    await service.run(zip({ scope: 'all' }), path.join(destination, 'all.zip'), idle);
    const gifs = path.join(destination, 'gifs');
    await fs.mkdir(gifs);
    await service.run(animation({ scope: 'all' }), gifs, idle);
    expect(await snapshot(projectPath)).toEqual(before);
    expect(await scenes.listScenes()).toEqual(registry);
  });

  it('exports what is saved, so later edits only appear after saving them', async () => {
    const { service, scenes, firstId, destination } = await setup();
    const target = path.join(destination, 'f2.png');
    await service.run({ ...common, kind: 'current-frame', frameId: 'f2' }, target, idle);
    expect(pixelAt(await readPng(target), 0, 0)).toEqual(GREEN);

    await scenes.saveAnimation(firstId, { width: WIDTH, height: HEIGHT, frames: [frame('f2', { pixels: solid(RED) })] });
    await service.run({ ...common, kind: 'current-frame', frameId: 'f2', overwrite: true }, target, idle);
    expect(pixelAt(await readPng(target), 0, 0)).toEqual(RED);
  });
});
