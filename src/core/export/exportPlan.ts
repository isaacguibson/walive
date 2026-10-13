import path from 'node:path';
import { frameFileName, frameNumberDigits } from './fileNames';
import type { AnimationFormat } from './animationFormat';
import type { SceneFrameSource } from '../project/sceneAnimation';
import type { ExportRequest } from '@shared/types/export';

/** A scene taking part in an export, with the frames selected from it. */
export interface SceneExport {
  name: string;
  /** Unique, filesystem-safe name for folders and file names; the scene itself is never renamed. */
  directory: string;
  source: SceneFrameSource;
  /** Zero-based, inclusive. */
  first: number;
  last: number;
}

export interface ExportPlan {
  /** Existing directory that receives the output. */
  root: string;
  /** Paths, relative to `root`, of what the export leaves behind. */
  outputs: string[];
  /** Names of the PNG images to write, in rendering order (inside the ZIP archive for `frames-zip`). */
  entries: string[];
  /** What the user is told about: the file, or the folder for multi-file exports. */
  resultPath: string;
}

export const frameCountOf = (scene: SceneExport): number => scene.last - scene.first + 1;

function withExtension(filePath: string, extension: string): string {
  return filePath.toLowerCase().endsWith(extension) ? filePath : `${filePath}${extension}`;
}

/** Decides where every file of the export goes, without touching the disk. */
export function planOutputs(
  request: ExportRequest,
  destination: string,
  scenes: readonly SceneExport[],
  format: AnimationFormat | null
): ExportPlan {
  const grouped = 'scope' in request && request.scope === 'all';
  const digits = frameNumberDigits(Math.max(...scenes.map((scene) => scene.last + 1)));
  const framePaths = scenes.flatMap((scene) =>
    Array.from({ length: frameCountOf(scene) }, (_, offset) => {
      const fileName = frameFileName(scene.first + offset + 1, digits);
      return grouped ? `${scene.directory}/${fileName}` : fileName;
    })
  );
  const singleFile = (extension: string, entries: string[]): ExportPlan => {
    const file = withExtension(destination, extension);
    return { root: path.dirname(file), outputs: [path.basename(file)], entries, resultPath: file };
  };

  switch (request.kind) {
    case 'current-frame': {
      const plan = singleFile('.png', []);
      return { ...plan, entries: plan.outputs };
    }
    case 'frames-zip':
      return singleFile('.zip', framePaths);
    case 'frames':
      return { root: destination, outputs: framePaths, entries: framePaths, resultPath: destination };
    case 'animation': {
      const extension = `.${format?.extension ?? ''}`;
      return grouped
        ? { root: destination, outputs: scenes.map((scene) => `${scene.directory}${extension}`), entries: [], resultPath: destination }
        : singleFile(extension, []);
    }
  }
}
