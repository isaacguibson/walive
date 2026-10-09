import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, type IpcChannel, type IpcRequest, type IpcResponse } from '@shared/ipc/channels';
import type { AppAPI } from '@shared/types/api';
import type { IpcResult } from '@shared/types/errors';

/** Calls one known channel and converts transport failures into an `IpcResult`. */
async function call<C extends IpcChannel>(channel: C, request?: IpcRequest<C>): Promise<IpcResult<IpcResponse<C>>> {
  try {
    return (await ipcRenderer.invoke(channel, request)) as IpcResult<IpcResponse<C>>;
  } catch {
    return {
      ok: false,
      error: { code: 'IPC_FAILURE', message: 'Unable to communicate with the application. Please restart it.' }
    };
  }
}

const api: AppAPI = {
  project: {
    createProject: (name, location, canvas) =>
      call(IPC_CHANNELS.createProject, canvas === undefined ? { name, location } : { name, location, canvas }),
    openProject: (path) => call(IPC_CHANNELS.openProject, path === undefined ? {} : { path }),
    getRecentProjects: () => call(IPC_CHANNELS.getRecentProjects),
    removeRecentProject: (projectId) => call(IPC_CHANNELS.removeRecentProject, { projectId }),
    closeProject: () => call(IPC_CHANNELS.closeProject),
    selectDirectory: () => call(IPC_CHANNELS.selectDirectory)
  },
  animation: {
    loadAnimation: () => call(IPC_CHANNELS.loadAnimation),
    saveAnimation: (document) => call(IPC_CHANNELS.saveAnimation, { document })
  },
  assets: {
    listAssets: () => call(IPC_CHANNELS.listAssets),
    readAssetImage: (assetId) => call(IPC_CHANNELS.readAssetImage, { assetId }),
    importAssets: () => call(IPC_CHANNELS.importAssets),
    renameAsset: (assetId, newName) => call(IPC_CHANNELS.renameAsset, { assetId, newName }),
    deleteAsset: (assetId) => call(IPC_CHANNELS.deleteAsset, { assetId })
  }
};

contextBridge.exposeInMainWorld('api', api);
