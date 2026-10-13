import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { AppError } from '../errors';
import { gifFormat } from '../export/gifFormat';
import { createMp4Format } from '../export/mp4Format';
import { ExportService } from '../export/exportService';
import { parseDestinationQuery, parseExportRequest } from '../export/exportRequest';
import { sanitizeFileName } from '../export/fileNames';
import { describeError, silentLogger, type Logger } from '../logger';
import type { ProjectService } from '../project/projectService';
import {
  destinationKindOf,
  type DestinationKind,
  type DestinationQuery,
  type ExportCapabilities,
  type ExportDestination,
  type ExportProgress,
  type ExportResult
} from '@shared/types/export';

export interface DestinationRequest {
  kind: DestinationKind;
  /** Proposed file name, extension included (files only). */
  suggestedName: string;
  /** Extension without dot the chosen file must have (files only). */
  extension: string | null;
  /** Folder the dialog opens in, when it exists. */
  defaultDirectory: string | null;
}

/** Native dialog that lets the user choose where to export. Implemented in the main process. */
export interface DestinationPicker {
  /** Resolves to an absolute path, or `null` when the dialog is cancelled. */
  pick(request: DestinationRequest): Promise<string | null>;
}

/** Shows exported files in the system file manager. Implemented in the main process. */
export interface OutputRevealer {
  reveal(outputPath: string): void;
}

export interface ExportApplicationOptions {
  picker: DestinationPicker;
  revealer: OutputRevealer;
  publishProgress(progress: ExportProgress): void;
  /** Path of the ffmpeg binary used for MP4, or `null` when none is bundled. */
  ffmpegPath: string | null;
  logger?: Logger;
}

interface ApprovedDestination extends ExportDestination {
  kind: DestinationKind;
}

function extensionOf(query: DestinationQuery): string | null {
  switch (query.kind) {
    case 'current-frame':
      return 'png';
    case 'frames-zip':
      return 'zip';
    case 'animation':
      return query.format;
    case 'frames':
      return null;
  }
}

/**
 * Export entry point for IPC handlers. It owns what the renderer must never decide: the output path
 * (only chosen in a native dialog and referred to by id afterwards) and the one running export.
 */
export class ExportApplication {
  private readonly service: ExportService;
  private readonly logger: Logger;
  private destination: ApprovedDestination | null = null;
  private running: AbortController | null = null;
  private lastOutput: string | null = null;

  constructor(
    private readonly projects: ProjectService,
    private readonly options: ExportApplicationOptions
  ) {
    this.logger = options.logger ?? silentLogger;
    this.service = new ExportService(
      {
        listScenes: () => this.projects.scenes.listScenes(),
        openFrames: (sceneId) => this.projects.scenes.openFrames(sceneId)
      },
      [createMp4Format(options.ffmpegPath), gifFormat]
    );
  }

  getCapabilities(): Promise<ExportCapabilities> {
    return this.service.getCapabilities();
  }

  async chooseDestination(input: unknown): Promise<ExportDestination | null> {
    const query = parseDestinationQuery(input);
    const kind = destinationKindOf(query);
    const extension = extensionOf(query);
    const project = this.projects.getCurrentProject();
    const chosen = await this.options.picker.pick({
      kind,
      suggestedName: `${sanitizeFileName(query.suggestedName, 'export')}${extension === null ? '' : `.${extension}`}`,
      extension,
      defaultDirectory: project === null ? null : path.join(project.path, 'exports')
    });
    if (chosen === null) {
      return null;
    }
    if (!path.isAbsolute(chosen)) {
      throw new AppError('INVALID_LOCATION', 'The chosen destination is not valid.');
    }
    this.destination = { id: randomUUID(), path: chosen, kind };
    return { id: this.destination.id, path: chosen };
  }

  async start(input: unknown): Promise<ExportResult> {
    const request = parseExportRequest(input);
    if (this.running !== null) {
      throw new AppError('EXPORT_BUSY', 'Another export is still running.');
    }
    const destination = this.destination;
    const kind = destinationKindOf({ kind: request.kind, scope: 'scope' in request ? request.scope : 'active' });
    if (destination === null || destination.id !== request.destinationId || destination.kind !== kind) {
      throw new AppError('INVALID_EXPORT', 'The destination is no longer valid. Choose it again.');
    }
    const controller = new AbortController();
    this.running = controller;
    this.logger.info('Export started', { kind: request.kind });
    try {
      const result = await this.service.run(request, destination.path, {
        signal: controller.signal,
        onProgress: this.options.publishProgress
      });
      this.lastOutput = result.outputPath;
      this.logger.info('Export finished', { kind: request.kind, files: result.fileCount });
      return result;
    } catch (error) {
      this.logger.warn('Export failed', describeError(error));
      throw error;
    } finally {
      this.running = null;
    }
  }

  cancel(): void {
    this.running?.abort();
  }

  reveal(): void {
    if (this.lastOutput === null) {
      throw new AppError('INVALID_EXPORT', 'There is no export to show.');
    }
    this.options.revealer.reveal(this.lastOutput);
  }
}
