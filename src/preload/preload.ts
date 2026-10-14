import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS, IPC_EVENTS, type IpcChannel, type IpcRequest, type IpcResponse } from '@shared/ipc/channels';
import type { AppAPI } from '@shared/types/api';
import type { ExportProgress } from '@shared/types/export';
import type { TurnEvent } from '@shared/ai/types';
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
    loadAnimation: (sceneId) => call(IPC_CHANNELS.loadAnimation, { sceneId }),
    saveAnimation: (sceneId, document) => call(IPC_CHANNELS.saveAnimation, { sceneId, document })
  },
  scenes: {
    listScenes: () => call(IPC_CHANNELS.listScenes),
    createScene: (name) => call(IPC_CHANNELS.createScene, { name }),
    renameScene: (sceneId, name) => call(IPC_CHANNELS.renameScene, { sceneId, name }),
    deleteScene: (sceneId) => call(IPC_CHANNELS.deleteScene, { sceneId }),
    selectScene: (sceneId) => call(IPC_CHANNELS.selectScene, { sceneId })
  },
  assets: {
    listAssets: () => call(IPC_CHANNELS.listAssets),
    readAssetImage: (assetId) => call(IPC_CHANNELS.readAssetImage, { assetId }),
    importAssets: () => call(IPC_CHANNELS.importAssets),
    renameAsset: (assetId, newName) => call(IPC_CHANNELS.renameAsset, { assetId, newName }),
    deleteAsset: (assetId) => call(IPC_CHANNELS.deleteAsset, { assetId })
  },
  export: {
    getCapabilities: () => call(IPC_CHANNELS.exportCapabilities),
    chooseDestination: (query) => call(IPC_CHANNELS.exportDestination, query),
    startExport: (request) => call(IPC_CHANNELS.exportStart, request),
    cancelExport: () => call(IPC_CHANNELS.exportCancel),
    revealOutput: () => call(IPC_CHANNELS.exportReveal),
    onProgress: (listener) => {
      // The Electron event is never handed to the renderer, only the progress payload.
      const subscription = (_event: unknown, progress: ExportProgress): void => listener(progress);
      ipcRenderer.on(IPC_EVENTS.exportProgress, subscription);
      return () => {
        ipcRenderer.removeListener(IPC_EVENTS.exportProgress, subscription);
      };
    }
  },
  ai: {
    getState: () => call(IPC_CHANNELS.aiGetState),
    saveProvider: (input) => call(IPC_CHANNELS.aiSaveProvider, input),
    removeProvider: (providerId) => call(IPC_CHANNELS.aiRemoveProvider, { providerId }),
    disconnectProvider: (providerId) => call(IPC_CHANNELS.aiDisconnectProvider, { providerId }),
    testProvider: (input) => call(IPC_CHANNELS.aiTestProvider, input),
    refreshModels: (providerId) => call(IPC_CHANNELS.aiRefreshModels, { providerId }),
    updatePreferences: (preferences) => call(IPC_CHANNELS.aiUpdatePreferences, preferences),
    runTurn: (request) => call(IPC_CHANNELS.aiRunTurn, request),
    cancelTurn: (requestId) => call(IPC_CHANNELS.aiCancelTurn, { requestId }),
    onTurnEvent: (listener) => {
      const subscription = (_event: unknown, turn: TurnEvent): void => listener(turn);
      ipcRenderer.on(IPC_EVENTS.aiTurn, subscription);
      return () => {
        ipcRenderer.removeListener(IPC_EVENTS.aiTurn, subscription);
      };
    },
    listConversations: () => call(IPC_CHANNELS.aiListConversations),
    loadConversation: (id) => call(IPC_CHANNELS.aiLoadConversation, { id }),
    saveConversation: (conversation) => call(IPC_CHANNELS.aiSaveConversation, conversation),
    renameConversation: (id, title) => call(IPC_CHANNELS.aiRenameConversation, { id, title }),
    deleteConversation: (id) => call(IPC_CHANNELS.aiDeleteConversation, { id }),
    clearConversations: () => call(IPC_CHANNELS.aiClearConversations),
    pickAttachments: () => call(IPC_CHANNELS.aiPickAttachments),
    listMcpServers: () => call(IPC_CHANNELS.aiListMcpServers),
    saveMcpServer: (input) => call(IPC_CHANNELS.aiSaveMcpServer, input),
    removeMcpServer: (serverId) => call(IPC_CHANNELS.aiRemoveMcpServer, { serverId }),
    connectMcpServer: (serverId) => call(IPC_CHANNELS.aiConnectMcpServer, { serverId }),
    disconnectMcpServer: (serverId) => call(IPC_CHANNELS.aiDisconnectMcpServer, { serverId }),
    testMcpServer: (serverId) => call(IPC_CHANNELS.aiTestMcpServer, { serverId }),
    listMcpTools: () => call(IPC_CHANNELS.aiListMcpTools),
    callMcpTool: (serverId, tool, input) => call(IPC_CHANNELS.aiCallMcpTool, { serverId, tool, input })
  }
};

contextBridge.exposeInMainWorld('api', api);
