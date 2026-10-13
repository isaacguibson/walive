import {
  ANIMATION_FORMAT_VERSION,
  compressPixels,
  decompressPixels,
  layerFileName,
  parseAnimationDocument,
  parseAnimationManifest,
  type AnimationManifest
} from './animationFormat';
import type { ProjectRepository } from './projectRepository';
import { AppError } from '../errors';
import type { AnimationDocument } from '@shared/types/animation';
import type { ProjectCanvas } from '@shared/types/project';

/** Names of the layer files a manifest refers to. */
export function layerFilesOf(manifest: AnimationManifest): Set<string> {
  const files = new Set<string>();
  for (const frame of manifest.frames) {
    for (const layer of frame.layers) {
      if (layer.file !== null) {
        files.add(layer.file);
      }
    }
  }
  return files;
}

/** Reads the stored animation of a scene. `null` when nothing has been saved yet. */
export async function readSceneAnimation(
  repository: ProjectRepository,
  projectPath: string,
  sceneId: string,
  canvas: ProjectCanvas
): Promise<AnimationDocument | null> {
  const raw = await repository.readAnimationManifest(projectPath, sceneId);
  if (raw === null) {
    return null;
  }
  const manifest = parseAnimationManifest(raw);
  if (manifest.width !== canvas.width || manifest.height !== canvas.height) {
    throw new AppError('INVALID_ANIMATION_DATA', 'The stored drawings do not match the canvas size of this project.');
  }
  const length = manifest.width * manifest.height * 4;
  const cache = new Map<string, Uint8Array>();
  const frames: AnimationDocument['frames'] = [];
  for (const frame of manifest.frames) {
    const layers: AnimationDocument['frames'][number]['layers'] = [];
    for (const layer of frame.layers) {
      let pixels: Uint8Array | null = null;
      if (layer.file !== null) {
        let cached = cache.get(layer.file);
        if (cached === undefined) {
          cached = await decompressPixels(await repository.readLayerFile(projectPath, layer.file), length);
          cache.set(layer.file, cached);
        }
        // Identical layers share one file; give each layer its own buffer.
        pixels = new Uint8Array(cached);
      }
      layers.push({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        pixels,
        ...(layer.curves !== undefined ? { curves: layer.curves } : {})
      });
    }
    frames.push({ id: frame.id, layers });
  }
  return {
    width: manifest.width,
    height: manifest.height,
    frames,
    ...(manifest.manualReferenceFrameId !== undefined
      ? { manualReferenceFrameId: manifest.manualReferenceFrameId }
      : {})
  };
}

/**
 * Persists the animation of a scene. Pixel files are written first and the
 * manifest last (atomically), so an interrupted save leaves the previous
 * animation intact.
 */
export async function writeSceneAnimation(
  repository: ProjectRepository,
  projectPath: string,
  sceneId: string,
  canvas: ProjectCanvas,
  input: unknown
): Promise<void> {
  const document = parseAnimationDocument(input);
  if (document.width !== canvas.width || document.height !== canvas.height) {
    throw new AppError('INVALID_ANIMATION_DATA', 'The drawings do not match the canvas size of this project.');
  }

  const written = new Set<string>();
  const manifest: AnimationManifest = {
    formatVersion: ANIMATION_FORMAT_VERSION,
    width: document.width,
    height: document.height,
    ...(document.manualReferenceFrameId !== undefined
      ? { manualReferenceFrameId: document.manualReferenceFrameId }
      : {}),
    frames: []
  };
  for (const frame of document.frames) {
    const layers: AnimationManifest['frames'][number]['layers'] = [];
    for (const layer of frame.layers) {
      let file: string | null = null;
      if (layer.pixels !== null && layer.pixels.some((byte) => byte !== 0)) {
        file = layerFileName(layer.pixels);
        if (!written.has(file)) {
          await repository.writeLayerFile(projectPath, file, await compressPixels(layer.pixels));
          written.add(file);
        }
      }
      layers.push({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        file,
        ...(layer.curves !== undefined && layer.curves.length > 0 ? { curves: [...layer.curves] } : {})
      });
    }
    manifest.frames.push({ id: frame.id, layers });
  }
  await repository.writeAnimationManifest(projectPath, sceneId, manifest);
}
