import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '@core/errors';
import { ProjectService } from '@core/project/projectService';
import type { AnimationDocument } from '@shared/types/animation';
import { makeTempDir } from '../helpers/tempDir';

const WIDTH = 4;
const HEIGHT = 3;
const LENGTH = WIDTH * HEIGHT * 4;

async function openSmallProject(): Promise<{ service: ProjectService; projectPath: string }> {
  const service = new ProjectService();
  const location = await makeTempDir();
  const { path: projectPath } = await service.createProject('Persist', location, {
    width: WIDTH,
    height: HEIGHT,
    keepAspectRatio: false
  });
  return { service, projectPath };
}

function pixels(fill: number): Uint8Array {
  const data = new Uint8Array(LENGTH);
  data.fill(fill);
  return data;
}

function document(overrides: Partial<AnimationDocument> = {}): AnimationDocument {
  return {
    width: WIDTH,
    height: HEIGHT,
    frames: [
      {
        id: 'frame-1',
        layers: [
          { id: 'layer-1', name: 'Top', visible: true, pixels: pixels(200) },
          { id: 'layer-2', name: 'Bottom', visible: false, pixels: null }
        ]
      },
      { id: 'frame-2', layers: [{ id: 'layer-3', name: 'Layer 1', visible: true, pixels: pixels(200) }] }
    ],
    ...overrides
  };
}

async function rejectionOf(promise: Promise<unknown>): Promise<AppError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(AppError);
    return error as AppError;
  }
  throw new Error('Expected the promise to reject');
}

async function layerFiles(projectPath: string): Promise<string[]> {
  return (await fs.readdir(path.join(projectPath, 'drawings', 'layers'))).sort();
}

describe('animation persistence', () => {
  it('returns null when nothing has been saved yet', async () => {
    const { service } = await openSmallProject();
    expect(await service.loadAnimation()).toBeNull();
  });

  it('round-trips frames, layers, names, visibility and pixels', async () => {
    const { service } = await openSmallProject();
    await service.saveAnimation(document());

    const loaded = await service.loadAnimation();
    expect(loaded).not.toBeNull();
    expect(loaded?.width).toBe(WIDTH);
    expect(loaded?.frames.map((frame) => frame.id)).toEqual(['frame-1', 'frame-2']);
    const first = loaded?.frames[0]?.layers;
    expect(first?.map((layer) => [layer.name, layer.visible])).toEqual([
      ['Top', true],
      ['Bottom', false]
    ]);
    expect(Array.from(first?.[0]?.pixels ?? [])).toEqual(Array.from(pixels(200)));
    expect(first?.[1]?.pixels).toBeNull();
  });

  it('stores the data inside the project drawings directory only', async () => {
    const { service, projectPath } = await openSmallProject();
    await service.saveAnimation(document());
    expect(await fs.stat(path.join(projectPath, 'drawings', 'animation.json'))).toBeTruthy();
    // Identical layers share a single content-addressed file; blank layers have none.
    expect(await layerFiles(projectPath)).toHaveLength(1);
  });

  it('removes layer files that are no longer referenced', async () => {
    const { service, projectPath } = await openSmallProject();
    await service.saveAnimation(document());
    await service.saveAnimation(
      document({ frames: [{ id: 'frame-1', layers: [{ id: 'layer-1', name: 'Only', visible: true, pixels: pixels(9) }] }] })
    );
    const files = await layerFiles(projectPath);
    expect(files).toHaveLength(1);
    const loaded = await service.loadAnimation();
    expect(Array.from(loaded?.frames[0]?.layers[0]?.pixels ?? [])).toEqual(Array.from(pixels(9)));
  });

  it('gives every loaded layer its own pixel buffer', async () => {
    const { service } = await openSmallProject();
    await service.saveAnimation(document());
    const loaded = await service.loadAnimation();
    const a = loaded?.frames[0]?.layers[0]?.pixels;
    const b = loaded?.frames[1]?.layers[0]?.pixels;
    expect(a).not.toBe(b);
    expect(a?.buffer).not.toBe(b?.buffer);
  });

  it('rejects documents whose size does not match the project canvas', async () => {
    const { service } = await openSmallProject();
    const error = await rejectionOf(service.saveAnimation(document({ width: 5 })));
    expect(error.code).toBe('INVALID_ANIMATION_DATA');
  });

  it('rejects malformed documents', async () => {
    const { service } = await openSmallProject();
    const bad: unknown[] = [
      null,
      'text',
      { width: WIDTH, height: HEIGHT, frames: [] },
      { width: WIDTH, height: HEIGHT, frames: [{ id: 'f', layers: [] }] },
      document({ frames: [{ id: 'f', layers: [{ id: 'l', name: 'x', visible: true, pixels: new Uint8Array(3) }] }] }),
      document({ frames: [{ id: 'f', layers: [{ id: 'l', name: '   ', visible: true, pixels: null }] }] }),
      document({
        frames: [
          { id: 'same', layers: [{ id: 'l1', name: 'x', visible: true, pixels: null }] },
          { id: 'same', layers: [{ id: 'l2', name: 'x', visible: true, pixels: null }] }
        ]
      }),
      document({ frames: [{ id: '../evil', layers: [{ id: 'l', name: 'x', visible: true, pixels: null }] }] })
    ];
    for (const input of bad) {
      expect((await rejectionOf(service.saveAnimation(input))).code).toBe('INVALID_ANIMATION_DATA');
    }
  });

  it('keeps the previous animation when a save is rejected', async () => {
    const { service } = await openSmallProject();
    await service.saveAnimation(document());
    await rejectionOf(service.saveAnimation({ width: WIDTH, height: HEIGHT, frames: [] }));
    expect((await service.loadAnimation())?.frames).toHaveLength(2);
  });

  it('fails clearly when the stored manifest is corrupted', async () => {
    const { service, projectPath } = await openSmallProject();
    await service.saveAnimation(document());
    await fs.writeFile(path.join(projectPath, 'drawings', 'animation.json'), '{ not json');
    expect((await rejectionOf(service.loadAnimation())).code).toBe('INVALID_ANIMATION_DATA');
  });

  it('fails clearly when a stored drawing is damaged', async () => {
    const { service, projectPath } = await openSmallProject();
    await service.saveAnimation(document());
    const [file] = await layerFiles(projectPath);
    await fs.writeFile(path.join(projectPath, 'drawings', 'layers', file ?? ''), Buffer.from('garbage'));
    expect((await rejectionOf(service.loadAnimation())).code).toBe('INVALID_ANIMATION_DATA');
  });

  it('requires an open project', async () => {
    const service = new ProjectService();
    expect((await rejectionOf(service.loadAnimation())).code).toBe('NO_PROJECT_OPEN');
    expect((await rejectionOf(service.saveAnimation(document()))).code).toBe('NO_PROJECT_OPEN');
  });
});
