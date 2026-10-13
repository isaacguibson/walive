import type { AnimationDocument } from '../types/animation';
import type { AssetImportResult, ProjectAsset } from '../types/assets';
import type { ProjectCanvas, ProjectMetadata, RecentProject } from '../types/project';
import type { SceneCollection } from '../types/scenes';

export const IPC_CHANNELS = {
  createProject: 'project:create',
  openProject: 'project:open',
  closeProject: 'project:close',
  getRecentProjects: 'project:get-recent',
  removeRecentProject: 'project:remove-recent',
  selectDirectory: 'project:select-directory',
  listScenes: 'scenes:list',
  createScene: 'scenes:create',
  renameScene: 'scenes:rename',
  deleteScene: 'scenes:delete',
  selectScene: 'scenes:select',
  loadAnimation: 'animation:load',
  saveAnimation: 'animation:save',
  listAssets: 'assets:list',
  readAssetImage: 'assets:read-image',
  importAssets: 'assets:import',
  renameAsset: 'assets:rename',
  deleteAsset: 'assets:delete'
} as const;

export type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export interface IpcContract {
  'project:create': { request: { name: string; location: string; canvas?: ProjectCanvas }; response: ProjectMetadata };
  'project:open': { request: { path?: string }; response: ProjectMetadata | null };
  'project:close': { request: undefined; response: void };
  'project:get-recent': { request: undefined; response: RecentProject[] };
  'project:remove-recent': { request: { projectId: string }; response: void };
  'project:select-directory': { request: undefined; response: string | null };
  'animation:load': { request: { sceneId: string }; response: AnimationDocument | null };
  'animation:save': { request: { sceneId: string; document: AnimationDocument }; response: void };
  'scenes:list': { request: undefined; response: SceneCollection };
  'scenes:create': { request: { name: string }; response: SceneCollection };
  'scenes:rename': { request: { sceneId: string; name: string }; response: SceneCollection };
  'scenes:delete': { request: { sceneId: string }; response: SceneCollection };
  'scenes:select': { request: { sceneId: string }; response: SceneCollection };
  'assets:list': { request: undefined; response: ProjectAsset[] };
  'assets:read-image': { request: { assetId: string }; response: string };
  'assets:import': { request: undefined; response: AssetImportResult };
  'assets:rename': { request: { assetId: string; newName: string }; response: ProjectAsset };
  'assets:delete': { request: { assetId: string }; response: void };
}

export type IpcRequest<C extends IpcChannel> = IpcContract[C]['request'];
export type IpcResponse<C extends IpcChannel> = IpcContract[C]['response'];

export const ALLOWED_IPC_CHANNELS: readonly IpcChannel[] = Object.values(IPC_CHANNELS);
