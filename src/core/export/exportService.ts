import type { AnimationFormat } from './animationFormat';
import { checkDestination } from './conflicts';
import { DirectoryEntryWriter, type EntryWriter } from './entryWriter';
import { ExportJob } from './exportJob';
import { frameCountOf, planOutputs, type ExportPlan, type SceneExport } from './exportPlan';
import { uniqueFileNames } from './fileNames';
import { outputSize, renderFrame } from './frameRender';
import { encodePng } from './png';
import { StagingArea } from './staging';
import { ZipWriter } from './zip';
import { AppError, isNodeError, isPermissionError } from '../errors';
import type { SceneFrameSource } from '../project/sceneAnimation';
import type { SceneCollection } from '@shared/types/scenes';
import type {
  AnimationExport,
  AnimationFormatId,
  ExportBackground,
  ExportCapabilities,
  ExportProgress,
  ExportRequest,
  ExportResolution,
  ExportResult
} from '@shared/types/export';

export interface ExportScenes {
  listScenes(): Promise<SceneCollection>;
  openFrames(sceneId: string): Promise<SceneFrameSource>;
}

export interface ExportRunOptions {
  signal: AbortSignal;
  onProgress(progress: ExportProgress): void;
}

const ORIGINAL_RESOLUTION: ExportResolution = { mode: 'original' };
const TRANSPARENT: ExportBackground = { type: 'transparent' };

function explain(error: unknown, cancelled: boolean, cleanupWarning: string | null): AppError {
  let result: AppError;
  if (cancelled) {
    result = new AppError('EXPORT_CANCELLED', 'The export was cancelled.');
  } else if (error instanceof AppError) {
    result = error;
  } else if (isNodeError(error) && error.code === 'ENOSPC') {
    result = new AppError('EXPORT_FAILED', 'There is not enough free disk space for this export. Free some space and try again.', { cause: error });
  } else if (isPermissionError(error)) {
    result = new AppError('PERMISSION_DENIED', 'The destination cannot be written to. Check the folder permissions or choose another folder.', { cause: error });
  } else {
    result = new AppError('EXPORT_FAILED', 'The export failed. Nothing was saved to the destination.', { cause: error });
  }
  return cleanupWarning === null ? result : new AppError(result.code, `${result.message} ${cleanupWarning}`, { cause: result.cause });
}

/**
 * Renders saved scenes and writes them as PNG files, a ZIP archive or an animation. Output is built in
 * a temporary folder inside the destination and only moved into place once everything succeeded.
 */
export class ExportService {
  private readonly formats: ReadonlyMap<AnimationFormatId, AnimationFormat>;

  constructor(
    private readonly scenes: ExportScenes,
    formats: readonly AnimationFormat[]
  ) {
    this.formats = new Map(formats.map((format) => [format.id, format]));
  }

  async getCapabilities(): Promise<ExportCapabilities> {
    const available = await Promise.all([...this.formats.values()].map(async (format) => ((await format.isAvailable()) ? format.id : null)));
    return { animationFormats: available.filter((id): id is AnimationFormatId => id !== null) };
  }

  /** `destination` is a file for single-file exports and an existing folder otherwise. */
  async run(request: ExportRequest, destination: string, { signal, onProgress }: ExportRunOptions): Promise<ExportResult> {
    const format = request.kind === 'animation' ? await this.requireFormat(request.format) : null;
    const selection = await this.selectScenes(request);
    const plan = planOutputs(request, destination, selection, format);
    await checkDestination(plan.root, plan.outputs, request.overwrite);

    const job = new ExportJob(selection.reduce((total, scene) => total + frameCountOf(scene), 0), signal, onProgress);
    job.throwIfCancelled();
    const staging = await StagingArea.create(plan.root);
    try {
      await this.produce(request, selection, plan, staging, job, format, signal);
      job.finalizing();
      job.throwIfCancelled();
      await staging.commit(plan.outputs, request.overwrite);
    } catch (error) {
      throw explain(error, signal.aborted, await staging.dispose());
    }
    const warning = await staging.dispose();
    return { outputPath: plan.resultPath, fileCount: plan.outputs.length, ...(warning === null ? {} : { warning }) };
  }

  private async requireFormat(id: AnimationFormatId): Promise<AnimationFormat> {
    const format = this.formats.get(id);
    if (format === undefined || !(await format.isAvailable())) {
      throw new AppError('EXPORT_UNSUPPORTED', `${id.toUpperCase()} export is not available on this system. Choose another format.`);
    }
    return format;
  }

  /** The scenes taking part in the export, with the frames to export from each. */
  private async selectScenes(request: ExportRequest): Promise<SceneExport[]> {
    const { scenes, activeSceneId } = await this.scenes.listScenes();
    const scope = 'scope' in request ? request.scope : 'active';
    const chosen = scope === 'all' ? scenes : scenes.filter((scene) => scene.id === activeSceneId);
    const directories = uniqueFileNames(chosen.map((scene) => scene.name));
    const result: SceneExport[] = [];
    for (const [index, scene] of chosen.entries()) {
      const source = await this.scenes.openFrames(scene.id);
      const count = source.frameIds.length;
      let first = 0;
      let last = count - 1;
      if (request.kind === 'current-frame') {
        first = last = source.frameIds.indexOf(request.frameId);
        if (first < 0) {
          throw new AppError('INVALID_EXPORT', 'The selected frame is not in the saved scene. Save the scene and try again.');
        }
      } else if (request.range !== null) {
        if (request.range.end > count) {
          throw new AppError('INVALID_EXPORT', `The scene has ${count} frame${count === 1 ? '' : 's'}. Choose a range within it.`);
        }
        first = request.range.start - 1;
        last = request.range.end - 1;
      }
      result.push({ name: scene.name, directory: directories[index] as string, source, first, last });
    }
    return result;
  }

  private async produce(
    request: ExportRequest,
    scenes: readonly SceneExport[],
    plan: ExportPlan,
    staging: StagingArea,
    job: ExportJob,
    format: AnimationFormat | null,
    signal: AbortSignal
  ): Promise<void> {
    if (request.kind === 'animation' && format !== null) {
      for (const [index, scene] of scenes.entries()) {
        await this.encodeAnimation(request, format, scene, staging.pathOf(plan.outputs[index] as string), job, signal);
      }
      return;
    }
    const writer: EntryWriter = request.kind === 'frames-zip' ? await ZipWriter.create(staging.pathOf(plan.outputs[0] as string)) : new DirectoryEntryWriter(staging.directory);
    try {
      let entry = 0;
      for (const scene of scenes) {
        const canvas = canvasOf(scene);
        const size = outputSize(canvas, 'resolution' in request ? request.resolution : ORIGINAL_RESOLUTION);
        for (const index of frameIndexes(scene)) {
          job.throwIfCancelled();
          const rgba = renderFrame(await scene.source.readFrame(index), canvas, size, TRANSPARENT);
          await writer.add(plan.entries[entry] as string, await encodePng(rgba, size.width, size.height));
          entry += 1;
          await job.frameDone(scene.name);
        }
      }
      await writer.finish();
    } catch (error) {
      await writer.abort();
      throw error;
    }
  }

  private async encodeAnimation(
    request: AnimationExport,
    format: AnimationFormat,
    scene: SceneExport,
    outputPath: string,
    job: ExportJob,
    signal: AbortSignal
  ): Promise<void> {
    const canvas = canvasOf(scene);
    const size = outputSize(canvas, request.resolution);
    const encoder = await format.createEncoder({
      outputPath,
      ...size,
      fps: request.fps,
      background: request.background,
      quality: request.quality,
      loop: request.loop,
      signal
    });
    try {
      for (const index of frameIndexes(scene)) {
        job.throwIfCancelled();
        await encoder.addFrame(renderFrame(await scene.source.readFrame(index), canvas, size, request.background));
        await job.frameDone(scene.name);
      }
      await encoder.finish();
    } catch (error) {
      await encoder.abort();
      throw error;
    }
  }
}

const canvasOf = (scene: SceneExport) => ({ width: scene.source.width, height: scene.source.height });

function frameIndexes(scene: SceneExport): number[] {
  return Array.from({ length: frameCountOf(scene) }, (_, offset) => scene.first + offset);
}
