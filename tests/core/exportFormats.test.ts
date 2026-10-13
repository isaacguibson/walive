import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { EncoderSettings } from '@core/export/animationFormat';
import { frameFileName, frameNumberDigits, sanitizeFileName, uniqueFileNames } from '@core/export/fileNames';
import { GifEncoder } from '@core/export/gif';
import { createGifDelays } from '@core/export/gifFormat';
import { buildFfmpegArgs } from '@core/export/mp4Format';
import { quantize } from '@core/export/palette';
import { encodePng } from '@core/export/png';
import { parseDestinationQuery, parseExportRequest } from '@core/export/exportRequest';
import { ZipWriter } from '@core/export/zip';
import { decodeGif, decodePng, readZip } from '../helpers/exportDecoders';
import { makeTempDir } from '../helpers/tempDir';

describe('file names', () => {
  it('sanitizes names for every operating system', () => {
    expect(sanitizeFileName('Scene: 1/2?')).toBe('Scene_12');
    expect(sanitizeFileName('  ..hidden. ')).toBe('hidden');
    expect(sanitizeFileName('CON')).toBe('_CON');
    expect(sanitizeFileName('nul.txt')).toBe('_nul.txt');
    expect(sanitizeFileName('???')).toBe('untitled');
    expect(sanitizeFileName('x'.repeat(300))).toHaveLength(100);
  });

  it('makes colliding names unique without being case sensitive', () => {
    expect(uniqueFileNames(['A B', 'A_B', 'a_b', 'Other'])).toEqual(['A_B', 'A_B_2', 'a_b_3', 'Other']);
  });

  it('pads frame numbers so they sort alphabetically', () => {
    expect(frameFileName(1, frameNumberDigits(9))).toBe('frame_0001.png');
    expect(frameFileName(10, frameNumberDigits(10))).toBe('frame_0010.png');
    expect(frameFileName(12345, frameNumberDigits(12345))).toBe('frame_12345.png');
  });
});

describe('PNG encoding', () => {
  it('keeps size and non-premultiplied alpha', async () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 10, 20, 30, 0, 1, 2, 3, 128, 0, 0, 0, 0]);
    const decoded = decodePng(await encodePng(rgba, 2, 2));
    expect([decoded.width, decoded.height]).toEqual([2, 2]);
    expect(Array.from(decoded.rgba)).toEqual(Array.from(rgba));
  });
});

describe('ZIP writer', () => {
  it('writes readable entries in order, with folders and UTF-8 names', async () => {
    const file = path.join(await makeTempDir(), 'out.zip');
    const writer = await ZipWriter.create(file);
    await writer.add('Cena_1/frame_0001.png', Buffer.from('one'));
    await writer.add('Cena_1/frame_0002.png', Buffer.from('two'));
    await writer.add('Ação/frame_0001.png', Buffer.alloc(0));
    await writer.finish();
    expect(readZip(await fs.readFile(file)).map((entry) => [entry.name, entry.data.toString()])).toEqual([
      ['Cena_1/frame_0001.png', 'one'],
      ['Cena_1/frame_0002.png', 'two'],
      ['Ação/frame_0001.png', '']
    ]);
  });

  it('refuses archives that would need ZIP64', async () => {
    const file = path.join(await makeTempDir(), 'big.zip');
    const writer = await ZipWriter.create(file);
    for (let index = 0; index < 65_535; index += 1) {
      await writer.add(`${index}`, Buffer.alloc(0));
    }
    await expect(writer.add('one-too-many', Buffer.alloc(0))).rejects.toMatchObject({ code: 'EXPORT_FAILED' });
    await writer.abort();
  });
});

function gradient(width: number, height: number): Uint8Array {
  const rgba = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      rgba.set([x * 2, y * 2, x + y, 255], (y * width + x) * 4);
    }
  }
  return rgba;
}

async function encodeGif(frames: Uint8Array[], settings: { width: number; height: number; loop?: boolean; maxColors?: number; transparent?: boolean }, delay = 5) {
  const parts: Buffer[] = [];
  const encoder = new GifEncoder({ loop: false, maxColors: 256, transparent: false, ...settings }, async (data) => void parts.push(data));
  for (const frame of frames) {
    await encoder.addFrame(frame, delay);
  }
  await encoder.finish();
  return Buffer.concat(parts);
}

describe('palette quantization', () => {
  it('never uses more colors than allowed and reserves an entry for transparency', () => {
    const image = quantize(gradient(64, 64), 64, true);
    expect(new Set(image.indices).size).toBeLessThanOrEqual(64);
    expect(image.bits).toBeLessThanOrEqual(6);
    expect(image.transparentIndex).not.toBeNull();
  });

  it('keeps flat colors exact', () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
    const image = quantize(rgba, 256, false);
    expect(image.bits).toBe(1);
    const colors = Array.from(image.indices, (index) => Array.from(image.palette.subarray(index * 3, index * 3 + 3)));
    expect(colors).toEqual([[255, 0, 0], [0, 255, 0], [255, 0, 0], [0, 255, 0]]);
  });
});

describe('GIF encoding', () => {
  it('round-trips frames, order and delays (including a large frame that resets the LZW table)', async () => {
    const first = gradient(128, 128);
    const second = new Uint8Array(128 * 128 * 4).fill(255);
    const gif = decodeGif(await encodeGif([first, second], { width: 128, height: 128 }, 7));
    expect(gif.frames.map((frame) => frame.delay)).toEqual([7, 7]);
    expect(gif.frames[1]?.rgba.every((value) => value === 255)).toBe(true);
    const decoded = gif.frames[0]?.rgba ?? new Uint8Array();
    let worst = 0;
    for (let index = 0; index < first.length; index += 1) {
      worst = Math.max(worst, Math.abs((decoded[index] as number) - (first[index] as number)));
    }
    expect(worst).toBeLessThan(48);
  });

  it('writes the loop extension only when looping is requested', async () => {
    const frame = new Uint8Array([1, 2, 3, 255]);
    expect(decodeGif(await encodeGif([frame], { width: 1, height: 1, loop: true })).loopCount).toBe(0);
    expect(decodeGif(await encodeGif([frame], { width: 1, height: 1, loop: false })).loopCount).toBeNull();
  });

  it('makes pixels below half opacity transparent when transparency is enabled', async () => {
    const rgba = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 127, 0, 0, 255, 128, 0, 0, 0, 0]);
    const [frame] = decodeGif(await encodeGif([rgba], { width: 2, height: 2, transparent: true })).frames;
    expect(Array.from(frame?.rgba ?? [])).toEqual([255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 255, 255, 0, 0, 0, 0]);
  });

  it('keeps the total duration right even when the frame rate does not divide a second', () => {
    const total = (fps: number, frames: number): number => {
      const next = createGifDelays(fps);
      return Array.from({ length: frames }, next).reduce((sum, delay) => sum + delay, 0);
    };
    expect(total(24, 24)).toBe(100);
    expect(total(30, 30)).toBe(100);
    expect(total(60, 60)).toBe(100);
    expect(total(10, 5)).toBe(50);
    // Above 100 fps a frame cannot last less than one hundredth of a second.
    const next = createGifDelays(120);
    expect(Array.from({ length: 10 }, next).every((delay) => delay >= 1)).toBe(true);
  });
});

describe('MP4 encoder settings', () => {
  const settings: EncoderSettings = {
    outputPath: '/tmp/out file; rm -rf.mp4',
    width: 7,
    height: 5,
    fps: 30,
    background: { type: 'color', color: '#112233' },
    quality: 'balanced',
    loop: false,
    signal: new AbortController().signal
  };
  const option = (args: string[], name: string): string | undefined => args[args.indexOf(name) + 1];

  it('maps each quality preset to encoder settings', () => {
    const mapped = (['low', 'balanced', 'high'] as const).map((quality) => {
      const args = buildFfmpegArgs({ ...settings, quality });
      return [option(args, '-crf'), option(args, '-preset')];
    });
    expect(mapped).toEqual([['28', 'veryfast'], ['23', 'medium'], ['18', 'slow']]);
  });

  it('describes the raw input, frame rate, background and output without any shell syntax', () => {
    const args = buildFfmpegArgs(settings);
    expect(option(args, '-s')).toBe('7x5');
    expect(option(args, '-framerate')).toBe('30');
    expect(option(args, '-vf')).toContain('color=0x112233');
    expect(args).toContain('-an');
    expect(args.at(-1)).toBe(settings.outputPath);
  });
});

describe('export request validation', () => {
  const base = { destinationId: 'dest-1', overwrite: false };
  const animation = {
    ...base,
    kind: 'animation',
    format: 'gif',
    scope: 'active',
    range: null,
    resolution: { mode: 'original' },
    fps: 24,
    background: { type: 'transparent' },
    quality: 'balanced',
    loop: true
  };

  it('accepts well-formed requests', () => {
    expect(parseExportRequest(animation)).toEqual(animation);
    expect(parseExportRequest({ ...base, kind: 'frames', scope: 'all', range: null, resolution: { mode: 'custom', width: 16, height: 9 } })).toMatchObject({ kind: 'frames' });
    expect(parseExportRequest({ ...base, kind: 'current-frame', frameId: 'f1' })).toMatchObject({ kind: 'current-frame' });
  });

  it('normalizes extra properties away', () => {
    expect(parseExportRequest({ ...base, kind: 'current-frame', frameId: 'f1', path: '/etc/passwd' })).not.toHaveProperty('path');
  });

  it('rejects invalid settings', () => {
    const invalid = [
      null,
      [],
      { ...animation, kind: 'avi' },
      { ...animation, format: 'webm' },
      { ...animation, format: 'mp4' },
      { ...animation, fps: 0 },
      { ...animation, fps: 24.5 },
      { ...animation, fps: 121 },
      { ...animation, quality: 'ultra' },
      { ...animation, loop: 'yes' },
      { ...animation, background: { type: 'color', color: 'red' } },
      { ...animation, range: { start: 3, end: 2 } },
      { ...animation, range: { start: 0, end: 2 } },
      { ...animation, scope: 'all', range: { start: 1, end: 2 } },
      { ...animation, resolution: { mode: 'custom', width: 0, height: 10 } },
      { ...animation, resolution: { mode: 'custom', width: 10.5, height: 10 } },
      { ...animation, resolution: { mode: 'custom', width: 100_000, height: 10 } },
      { ...animation, resolution: { mode: 'custom', width: 8192, height: 8192 } },
      { ...animation, destinationId: '../../etc' },
      { ...animation, destinationId: undefined },
      { ...animation, overwrite: 1 },
      { ...base, kind: 'current-frame' },
      { ...base, kind: 'current-frame', frameId: '../x' }
    ];
    for (const request of invalid) {
      expect(() => parseExportRequest(request), JSON.stringify(request)).toThrowError(expect.objectContaining({ code: 'INVALID_EXPORT' }));
    }
  });

  it('explains why MP4 cannot be transparent', () => {
    expect(() => parseExportRequest({ ...animation, format: 'mp4' })).toThrowError(/transparency/);
  });

  it('validates destination queries', () => {
    const query = { kind: 'frames-zip', scope: 'all', format: 'mp4', suggestedName: 'Name' };
    expect(parseDestinationQuery(query)).toEqual(query);
    for (const invalid of [{ ...query, kind: 'x' }, { ...query, scope: 'x' }, { ...query, format: 'x' }, { ...query, suggestedName: 'x'.repeat(201) }, { ...query, suggestedName: 1 }]) {
      expect(() => parseDestinationQuery(invalid)).toThrowError(expect.objectContaining({ code: 'INVALID_EXPORT' }));
    }
  });
});
