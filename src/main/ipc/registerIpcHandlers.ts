import type { Logger } from '@core/logger';
import type { ProjectApplication } from '@core/application/projectApplication';
import type { ExportApplication } from '@core/application/exportApplication';
import { IPC_CHANNELS, type IpcRequest } from '@shared/ipc/channels';
import { sanitizeToolWindowLayout, type ToolWindowLayout } from '@shared/types/layout';
import { asRecord, createRegistrar, requireString, type IpcMainLike } from './ipcSupport';

export type { IpcMainLike };

/** Native directory selection, implemented in the main process. */
export interface DirectoryPicker {
  pickDirectory(): Promise<string | null>;
}

/** Native multi-file selection for asset import, implemented in the main process. */
export interface AssetFilePicker {
  /** Resolves to the chosen absolute paths, or an empty list when the dialog is cancelled. */
  pickFiles(): Promise<string[]>;
}

/** Where the tool-window layout preference is kept. */
export interface LayoutStore {
  read(): Promise<ToolWindowLayout>;
  write(layout: ToolWindowLayout): Promise<void>;
}

export interface IpcDependencies {
  ipc: IpcMainLike;
  application: ProjectApplication;
  exports: ExportApplication;
  directoryPicker: DirectoryPicker;
  assetPicker: AssetFilePicker;
  layoutStore?: LayoutStore;
  logger: Logger;
}

/** Registers exactly the channels defined in `IPC_CHANNELS`; nothing generic is exposed. */
export function registerIpcHandlers({
  ipc,
  application,
  exports,
  directoryPicker,
  assetPicker,
  layoutStore,
  logger
}: IpcDependencies): void {
  const register = createRegistrar(ipc, logger);

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

  register(IPC_CHANNELS.getLayout, async () => sanitizeToolWindowLayout(await layoutStore?.read()));

  register(IPC_CHANNELS.saveLayout, async (payload) => {
    await layoutStore?.write(sanitizeToolWindowLayout(payload));
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
