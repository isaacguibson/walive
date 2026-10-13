import { promises as fs } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppError } from '@core/errors';
import { ProjectService } from '@core/project/projectService';
import type { AnimationDocument } from '@shared/types/animation';
import { CURVE_LIMITS, type BezierCurveData } from '@shared/types/curves';
import { makeTempDir } from '../helpers/tempDir';

const WIDTH = 4;
const HEIGHT = 3;
const LENGTH = WIDTH * HEIGHT * 4;

const NO_HANDLE = { x: 0, y: 0 };

function curve(id = 'curve-1'): BezierCurveData {
  return {
    id,
    anchors: [
      { x: 0.5, y: 1, type: 'corner', handleIn: NO_HANDLE, handleOut: { x: 1, y: -1 } },
      { x: 3, y: 2, type: 'smooth', handleIn: { x: -1, y: 0 }, handleOut: { x: 1, y: 0 } }
    ],
    style: { brush: 'basic', settings: { hardness: 80 }, color: '#ff0000', size: 3, opacity: 50, seed: 7 }
  };
}

function withCurves(curves: unknown): unknown {
  const base = document();
  const [first, ...rest] = base.frames;
  const [layer, ...layers] = first?.layers ?? [];
  return { ...base, frames: [{ ...first, layers: [{ ...layer, curves }, ...layers] }, ...rest] };
}

async function openSmallProject() {
  const projects = new ProjectService();
  const location = await makeTempDir();
  const { path: projectPath } = await projects.createProject('Persist', location, {
    width: WIDTH,
    height: HEIGHT,
    keepAspectRatio: false
  });
  const { activeSceneId } = await projects.scenes.listScenes();
  // Scene-bound shortcut: these tests exercise one scene.
  const service = {
    loadAnimation: () => projects.scenes.loadAnimation(activeSceneId),
    saveAnimation: (input: unknown) => projects.scenes.saveAnimation(activeSceneId, input)
  };
  return { service, projectPath, manifestPath: path.join(projectPath, 'scenes', activeSceneId, 'animation.json') };
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

  it('round-trips a manual onion reference and accepts older manifests without one', async () => {
    const { service, manifestPath } = await openSmallProject();
    await service.saveAnimation(document({ manualReferenceFrameId: 'frame-1' }));

    expect((await service.loadAnimation())?.manualReferenceFrameId).toBe('frame-1');
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as Record<string, unknown>;
    delete manifest.manualReferenceFrameId;
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    expect((await service.loadAnimation())?.manualReferenceFrameId).toBeUndefined();
  });

  it('stores the data inside the project scenes and drawings directories only', async () => {
    const { service, projectPath, manifestPath } = await openSmallProject();
    await service.saveAnimation(document());
    expect(await fs.stat(manifestPath)).toBeTruthy();
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
      document({ frames: [{ id: '../evil', layers: [{ id: 'l', name: 'x', visible: true, pixels: null }] }] }),
      document({ manualReferenceFrameId: 'missing-frame' })
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
    const { service, projectPath, manifestPath } = await openSmallProject();
    await service.saveAnimation(document());
    await fs.writeFile(manifestPath, '{ not json');
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
    const service = new ProjectService().scenes;
    expect((await rejectionOf(service.loadAnimation('x'))).code).toBe('NO_PROJECT_OPEN');
    expect((await rejectionOf(service.saveAnimation('x', document()))).code).toBe('NO_PROJECT_OPEN');
  });
});

describe('curve persistence', () => {
  it('round-trips the curves of a layer', async () => {
    const { service } = await openSmallProject();
    await service.saveAnimation(withCurves([curve('a'), curve('b')]));
    const layer = (await service.loadAnimation())?.frames[0]?.layers[0];
    expect(layer?.curves).toEqual([curve('a'), curve('b')]);
  });

  it('writes no curves key for layers without curves and loads older manifests', async () => {
    const { service, manifestPath } = await openSmallProject();
    await service.saveAnimation(withCurves([]));
    expect(await fs.readFile(manifestPath, 'utf8')).not.toContain('curves');
    expect((await service.loadAnimation())?.frames[0]?.layers[0]?.curves).toBeUndefined();
  });

  it('keeps a layer that only has curves and no pixels', async () => {
    const { service } = await openSmallProject();
    const input = withCurves([curve()]) as AnimationDocument;
    const layers = input.frames[0]?.layers ?? [];
    await service.saveAnimation({ ...input, frames: [{ id: 'f', layers: [{ ...layers[0], pixels: null }] }] });
    const layer = (await service.loadAnimation())?.frames[0]?.layers[0];
    expect(layer?.pixels).toBeNull();
    expect(layer?.curves).toHaveLength(1);
  });

  it('rejects malformed curves', async () => {
    const { service } = await openSmallProject();
    const good = curve();
    const anchor = good.anchors[0];
    const bad: unknown[] = [
      'curves',
      [{ ...good, id: '../evil' }],
      [good, good],
      [{ ...good, anchors: [anchor] }],
      [{ ...good, anchors: [anchor, { ...anchor, x: Number.NaN }] }],
      [{ ...good, anchors: [anchor, { ...anchor, x: CURVE_LIMITS.maxCoordinate + 1 }] }],
      [{ ...good, anchors: [anchor, { ...anchor, type: 'round' }] }],
      [{ ...good, anchors: [anchor, { ...anchor, handleOut: null }] }],
      [{ ...good, style: { ...good.style, color: 'red' } }],
      [{ ...good, style: { ...good.style, settings: { hardness: 'soft' } } }],
      [{ ...good, style: { ...good.style, size: Infinity } }],
      Array.from({ length: CURVE_LIMITS.maxCurvesPerLayer + 1 }, (_, index) => curve(`c${index}`))
    ];
    for (const curves of bad) {
      expect((await rejectionOf(service.saveAnimation(withCurves(curves)))).code).toBe('INVALID_ANIMATION_DATA');
    }
  });

  it('fails clearly when stored curves are damaged', async () => {
    const { service, manifestPath } = await openSmallProject();
    await service.saveAnimation(withCurves([curve()]));
    const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as { frames: { layers: { curves: unknown }[] }[] };
    (manifest.frames[0] as { layers: { curves: unknown }[] }).layers[0]!.curves = [{ id: 'x' }];
    await fs.writeFile(manifestPath, JSON.stringify(manifest));
    expect((await rejectionOf(service.loadAnimation())).code).toBe('INVALID_ANIMATION_DATA');
  });
});
