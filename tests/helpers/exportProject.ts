import { ProjectService } from '@core/project/projectService';
import type { AnimationDocument } from '@shared/types/animation';
import type { BezierCurveData } from '@shared/types/curves';
import { makeTempDir } from './tempDir';

export const WIDTH = 8;
export const HEIGHT = 6;

export type Rgba = [number, number, number, number];

export function solid(color: Rgba, width = WIDTH, height = HEIGHT): Uint8Array {
  const pixels = new Uint8Array(width * height * 4);
  for (let index = 0; index < pixels.length; index += 4) {
    pixels.set(color, index);
  }
  return pixels;
}

/** A transparent layer with a few colored pixels, given as `[x, y, color]`. */
export function dots(points: Array<[number, number, Rgba]>): Uint8Array {
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4);
  for (const [x, y, color] of points) {
    pixels.set(color, (y * WIDTH + x) * 4);
  }
  return pixels;
}

interface LayerSpec {
  pixels: Uint8Array | null;
  visible?: boolean;
  curves?: BezierCurveData[];
}

export function frame(id: string, ...layers: LayerSpec[]): AnimationDocument['frames'][number] {
  return {
    id,
    layers: layers.map((layer, index) => ({
      id: `${id}-layer-${index}`,
      name: `Layer ${index + 1}`,
      visible: layer.visible ?? true,
      pixels: layer.pixels,
      ...(layer.curves ? { curves: layer.curves } : {})
    }))
  };
}

export const DIAGONAL_CURVE: BezierCurveData = {
  id: 'curve-1',
  anchors: [
    { x: 0.5, y: 0.5, type: 'corner', handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } },
    { x: 7.5, y: 5.5, type: 'corner', handleIn: { x: 0, y: 0 }, handleOut: { x: 0, y: 0 } }
  ],
  style: { brush: 'basic', settings: { hardness: 100 }, color: '#ff0000', size: 2, opacity: 100, seed: 1 }
};

export const RED: Rgba = [255, 0, 0, 255];
export const GREEN: Rgba = [0, 255, 0, 255];
export const BLUE: Rgba = [0, 0, 255, 255];

/**
 * Project with two scenes. "A B" is the active scene and has four frames: f1 (blue dot over red),
 * f2 (green with a hidden layer), f3 (fully transparent) and f4 (a Bézier curve only).
 * "A_B" has two frames; both names sanitize to the same folder name.
 */
export async function createExportFixture() {
  const projects = new ProjectService();
  const location = await makeTempDir();
  const { path: projectPath } = await projects.createProject('Export', location, { width: WIDTH, height: HEIGHT, keepAspectRatio: false });
  const { scenes: initial } = await projects.scenes.listScenes();
  const firstId = (initial[0] as { id: string }).id;
  await projects.scenes.renameScene(firstId, 'A B');
  const second = await projects.scenes.createScene('A_B');
  const secondId = second.activeSceneId;
  await projects.scenes.selectScene(firstId);

  const save = (sceneId: string, frames: AnimationDocument['frames']) =>
    projects.scenes.saveAnimation(sceneId, { width: WIDTH, height: HEIGHT, frames });
  await save(firstId, [
    frame('f1', { pixels: dots([[1, 1, BLUE]]) }, { pixels: solid(RED) }),
    frame('f2', { pixels: solid(BLUE), visible: false }, { pixels: solid(GREEN) }),
    frame('f3', { pixels: null }),
    frame('f4', { pixels: null, curves: [DIAGONAL_CURVE] })
  ]);
  await save(secondId, [frame('g1', { pixels: solid(BLUE) }), frame('g2', { pixels: solid(GREEN) })]);

  const destination = await makeTempDir();
  return { projects, projectPath, firstId, secondId, destination };
}
