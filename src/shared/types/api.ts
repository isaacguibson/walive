import type { IpcResult } from './errors';
import type { AnimationDocument } from './animation';
import type { ProjectCanvas, ProjectMetadata, RecentProject } from './project';

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
 * Persistence of the animation content (frames, layers, drawings) of the open
 * project. The renderer never touches files; Project Management owns storage.
 */
export interface AnimationAPI {
  /** Resolves to `null` when the project has no stored animation yet. */
  loadAnimation(): Promise<IpcResult<AnimationDocument | null>>;
  saveAnimation(document: AnimationDocument): Promise<IpcResult<void>>;
}

export interface AppAPI {
  project: ProjectAPI;
  animation: AnimationAPI;
}
