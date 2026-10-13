import type { IpcResult } from './errors';
import type { AnimationDocument } from './animation';
import type { AssetImportResult, ProjectAsset } from './assets';
import type {
  DestinationQuery,
  ExportCapabilities,
  ExportDestination,
  ExportProgress,
  ExportRequest,
  ExportResult
} from './export';
import type { ProjectCanvas, ProjectMetadata, RecentProject } from './project';
import type { SceneCollection } from './scenes';

/**
 * API exposed to the renderer by the preload script (`window.api.project`).
 * Every call resolves to an `IpcResult`; failures never reject.
 */
export interface ProjectAPI {
  createProject(name: string, location: string, canvas?: ProjectCanvas): Promise<IpcResult<ProjectMetadata>>;
  /**
   * Opens a project. When `path` is omitted the main process shows the native
   * directory dialog. Resolves to `null` when the user cancels the dialog.
   */
  openProject(path?: string): Promise<IpcResult<ProjectMetadata | null>>;
  getRecentProjects(): Promise<IpcResult<RecentProject[]>>;
  removeRecentProject(projectId: string): Promise<IpcResult<void>>;
  closeProject(): Promise<IpcResult<void>>;
  /** Native directory picker, used to choose a project location. `null` if cancelled. */
  selectDirectory(): Promise<IpcResult<string | null>>;
}

/**
 * Persistence of the animation content (frames, layers, drawings) of each
 * scene of the open project. The renderer never touches files; Project
 * Management owns storage.
 */
export interface AnimationAPI {
  /** Resolves to `null` when the scene has no stored animation yet. */
  loadAnimation(sceneId: string): Promise<IpcResult<AnimationDocument | null>>;
  saveAnimation(sceneId: string, document: AnimationDocument): Promise<IpcResult<void>>;
}

/**
 * Scenes of the open project (HU_00011). Every operation resolves to the
 * updated collection, so the renderer never has to guess the outcome.
 */
export interface ScenesAPI {
  listScenes(): Promise<IpcResult<SceneCollection>>;
  /** Creates a scene and makes it the active one. */
  createScene(name: string): Promise<IpcResult<SceneCollection>>;
  renameScene(sceneId: string, name: string): Promise<IpcResult<SceneCollection>>;
  /** Deletes a scene; when it was active, the main process picks the next active one. */
  deleteScene(sceneId: string): Promise<IpcResult<SceneCollection>>;
  selectScene(sceneId: string): Promise<IpcResult<SceneCollection>>;
}

/**
 * Project-wide asset management (HU_00005 §7). The renderer only works with
 * opaque asset ids; the main process owns every file path and file dialog.
 */
export interface AssetsAPI {
  listAssets(): Promise<IpcResult<ProjectAsset[]>>;
  readAssetImage(assetId: string): Promise<IpcResult<string>>;
  /** Shows the native file picker and copies the chosen files into the project. */
  importAssets(): Promise<IpcResult<AssetImportResult>>;
  /** Renames an asset. `newName` is the name without extension; the extension is preserved. */
  renameAsset(assetId: string, newName: string): Promise<IpcResult<ProjectAsset>>;
  deleteAsset(assetId: string): Promise<IpcResult<void>>;
}

/**
 * Frame and animation export (HU_00012). Output paths are chosen in native
 * dialogs owned by the main process; the renderer only refers to them by id.
 */
export interface ExportAPI {
  /** Formats whose encoder is available on this machine. */
  getCapabilities(): Promise<IpcResult<ExportCapabilities>>;
  /** Shows the native file or folder dialog. Resolves to `null` when cancelled. */
  chooseDestination(query: DestinationQuery): Promise<IpcResult<ExportDestination | null>>;
  /** Runs the export and resolves when it finished, failed or was cancelled. */
  startExport(request: ExportRequest): Promise<IpcResult<ExportResult>>;
  cancelExport(): Promise<IpcResult<void>>;
  /** Shows the output of the last successful export in the file manager. */
  revealOutput(): Promise<IpcResult<void>>;
  /** Subscribes to export progress; returns the unsubscribe function. */
  onProgress(listener: (progress: ExportProgress) => void): () => void;
}

export interface AppAPI {
  project: ProjectAPI;
  animation: AnimationAPI;
  scenes: ScenesAPI;
  assets: AssetsAPI;
  export: ExportAPI;
}
