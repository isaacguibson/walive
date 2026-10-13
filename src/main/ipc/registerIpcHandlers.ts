import { AppError, toAppErrorInfo } from '@core/errors';
import { describeError, type Logger } from '@core/logger';
import type { ProjectApplication } from '@core/application/projectApplication';
import type { ExportApplication } from '@core/application/exportApplication';
import {
  IPC_CHANNELS,
  type IpcChannel,
  type IpcRequest,
  type IpcResponse
} from '@shared/ipc/channels';
import type { IpcResult } from '@shared/types/errors';

/** Minimal slice of Electron's `ipcMain` used here, so handlers are testable without Electron. */
export interface IpcMainLike {
  handle(channel: string, listener: (event: unknown, payload?: unknown) => unknown): void;
}

/** Native directory selection, implemented in the main process. */
export interface DirectoryPicker {
  pickDirectory(): Promise<string | null>;
}

/** Native multi-file selection for asset import, implemented in the main process. */
export interface AssetFilePicker {
  /** Resolves to the chosen absolute paths, or an empty list when the dialog is cancelled. */
  pickFiles(): Promise<string[]>;
}

export interface IpcDependencies {
  ipc: IpcMainLike;
  application: ProjectApplication;
  exports: ExportApplication;
  directoryPicker: DirectoryPicker;
  assetPicker: AssetFilePicker;
  logger: Logger;
}

function invalidRequest(): AppError {
  return new AppError('INVALID_REQUEST', 'The request could not be processed.');
}

function asRecord(payload: unknown): Record<string, unknown> {
  if (typeof payload !== 'object' || payload === null) {
    throw invalidRequest();
  }
  return payload as Record<string, unknown>;
}

function requireString(value: unknown): string {
  if (typeof value !== 'string') {
    throw invalidRequest();
  }
  return value;
}

/** Registers exactly the channels defined in `IPC_CHANNELS`; nothing generic is exposed. */
export function registerIpcHandlers({
  ipc,
  application,
  exports,
  directoryPicker,
  assetPicker,
  logger
}: IpcDependencies): void {
  function register<C extends IpcChannel>(
    channel: C,
    handler: (request: unknown) => Promise<IpcResponse<C>> | IpcResponse<C>
  ): void {
    ipc.handle(channel, async (_event, payload): Promise<IpcResult<IpcResponse<C>>> => {
      try {
        return { ok: true, value: await handler(payload) };
      } catch (error) {
        if (!(error instanceof AppError)) {
          logger.error(`Unexpected error in ${channel}`, describeError(error));
        }
        return { ok: false, error: toAppErrorInfo(error) };
      }
    });
  }

  register(IPC_CHANNELS.createProject, async (payload) => {
    const request = asRecord(payload) as Partial<IpcRequest<'project:create'>>;
    return application.createProject(
      requireString(request.name),
      requireString(request.location),
      request.canvas === undefined ? undefined : (request.canvas as IpcRequest<'project:create'>['canvas'])
    );
  });

  register(IPC_CHANNELS.openProject, async (payload) => {
    const request = (payload === undefined || payload === null ? {} : asRecord(payload)) as IpcRequest<'project:open'>;
    let projectPath = request.path;
    if (projectPath === undefined) {
      projectPath = (await directoryPicker.pickDirectory()) ?? undefined;
      if (projectPath === undefined) {
        return null;
      }
    }
    return application.openProject(requireString(projectPath));
  });

  register(IPC_CHANNELS.closeProject, () => application.closeProject());

  register(IPC_CHANNELS.getRecentProjects, () => application.getRecentProjects());

  register(IPC_CHANNELS.removeRecentProject, async (payload) => {
    const request = asRecord(payload) as Partial<IpcRequest<'project:remove-recent'>>;
    return application.removeRecentProject(requireString(request.projectId));
  });

  register(IPC_CHANNELS.selectDirectory, () => directoryPicker.pickDirectory());

  register(IPC_CHANNELS.loadAnimation, async (payload) => {
    const request = asRecord(payload) as Partial<IpcRequest<'animation:load'>>;
    return application.loadAnimation(requireString(request.sceneId));
  });

  register(IPC_CHANNELS.saveAnimation, async (payload) => {
    const request = asRecord(payload) as Partial<IpcRequest<'animation:save'>>;
    return application.saveAnimation(requireString(request.sceneId), request.document);
  });

  register(IPC_CHANNELS.listScenes, () => application.listScenes());

  register(IPC_CHANNELS.createScene, async (payload) => {
    const request = asRecord(payload) as Partial<IpcRequest<'scenes:create'>>;
    return application.createScene(requireString(request.name));
  });

  register(IPC_CHANNELS.renameScene, async (payload) => {
    const request = asRecord(payload) as Partial<IpcRequest<'scenes:rename'>>;
    return application.renameScene(requireString(request.sceneId), requireString(request.name));
  });

  register(IPC_CHANNELS.deleteScene, async (payload) => {
    const request = asRecord(payload) as Partial<IpcRequest<'scenes:delete'>>;
    return application.deleteScene(requireString(request.sceneId));
  });

  register(IPC_CHANNELS.selectScene, async (payload) => {
    const request = asRecord(payload) as Partial<IpcRequest<'scenes:select'>>;
    return application.selectScene(requireString(request.sceneId));
  });

  register(IPC_CHANNELS.listAssets, () => application.listAssets());

  register(IPC_CHANNELS.readAssetImage, async (payload) => {
    const request = asRecord(payload) as Partial<IpcRequest<'assets:read-image'>>;
    return application.readAssetImage(requireString(request.assetId));
  });

  register(IPC_CHANNELS.importAssets, async () => {
    const paths = await assetPicker.pickFiles();
    if (paths.length === 0) {
      return { imported: [], skipped: [] };
    }
    return application.importAssets(paths);
  });

  register(IPC_CHANNELS.renameAsset, async (payload) => {
    const request = asRecord(payload) as Partial<IpcRequest<'assets:rename'>>;
    return application.renameAsset(requireString(request.assetId), requireString(request.newName));
  });

  register(IPC_CHANNELS.deleteAsset, async (payload) => {
    const request = asRecord(payload) as Partial<IpcRequest<'assets:delete'>>;
    return application.deleteAsset(requireString(request.assetId));
  });

  register(IPC_CHANNELS.exportCapabilities, () => exports.getCapabilities());

  register(IPC_CHANNELS.exportDestination, (payload) => exports.chooseDestination(payload));

  register(IPC_CHANNELS.exportStart, (payload) => exports.start(payload));

  register(IPC_CHANNELS.exportCancel, () => exports.cancel());

  register(IPC_CHANNELS.exportReveal, () => exports.reveal());
}
