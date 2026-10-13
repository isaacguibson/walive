import type { RecentProjectsService } from './recentProjectsService';
import { AssetService } from '../assets/assetService';
import { describeError, silentLogger, type Logger } from '../logger';
import type { ProjectService } from '../project/projectService';
import type { OpenProject } from '../project/types';
import type { AnimationDocument } from '@shared/types/animation';
import type { AssetImportResult, ProjectAsset } from '@shared/types/assets';
import type { ProjectCanvas, ProjectMetadata, RecentProject } from '@shared/types/project';
import type { SceneCollection } from '@shared/types/scenes';

/**
 * Application-level project API used by IPC handlers (and, later, by other
 * modules such as AI/MCP tools). Combines the project layer with the recent-
 * project registry so callers never coordinate the two themselves.
 */
export class ProjectApplication {
  private readonly assets: AssetService;

  constructor(
    private readonly projects: ProjectService,
    private readonly recents: RecentProjectsService,
    private readonly logger: Logger = silentLogger
  ) {
    this.assets = new AssetService({ getProjectPath: () => this.projects.getCurrentProject()?.path ?? null });
  }

  async createProject(name: string, location: string, canvas?: ProjectCanvas): Promise<ProjectMetadata> {
    this.logger.info('Project creation started');
    try {
      const project = await this.projects.createProject(name, location, canvas);
      this.logger.info('Project created', { projectId: project.metadata.id });
      await this.registerRecent(project);
      return project.metadata;
    } catch (error) {
      this.logger.warn('Project creation failed', describeError(error));
      throw error;
    }
  }

  async openProject(projectPath: string): Promise<ProjectMetadata> {
    try {
      const project = await this.projects.openProject(projectPath);
      this.logger.info('Project opened', { projectId: project.metadata.id });
      await this.registerRecent(project);
      return project.metadata;
    } catch (error) {
      this.logger.warn('Project validation failed', describeError(error));
      throw error;
    }
  }

  closeProject(): void {
    const current = this.projects.getCurrentProject();
    this.projects.closeProject();
    if (current) {
      this.logger.info('Project closed', { projectId: current.metadata.id });
    }
  }

  /** Stored animation of a scene, or `null` when nothing was saved in it yet. */
  loadAnimation(sceneId: string): Promise<AnimationDocument | null> {
    return this.logFailure('Animation load', () => this.projects.scenes.loadAnimation(sceneId));
  }

  async saveAnimation(sceneId: string, document: unknown): Promise<void> {
    await this.logFailure('Animation save', () => this.projects.scenes.saveAnimation(sceneId, document));
    this.logger.info('Animation saved');
  }

  listScenes(): Promise<SceneCollection> {
    return this.logFailure('Scene list', () => this.projects.scenes.listScenes());
  }

  createScene(name: string): Promise<SceneCollection> {
    return this.logFailure('Scene creation', () => this.projects.scenes.createScene(name));
  }

  renameScene(sceneId: string, name: string): Promise<SceneCollection> {
    return this.logFailure('Scene rename', () => this.projects.scenes.renameScene(sceneId, name));
  }

  deleteScene(sceneId: string): Promise<SceneCollection> {
    return this.logFailure('Scene deletion', () => this.projects.scenes.deleteScene(sceneId));
  }

  selectScene(sceneId: string): Promise<SceneCollection> {
    return this.logFailure('Scene selection', () => this.projects.scenes.selectScene(sceneId));
  }

  listAssets(): Promise<ProjectAsset[]> {
    return this.logFailure('Asset list', () => this.assets.listAssets());
  }

  readAssetImage(assetId: string): Promise<string> {
    return this.logFailure('Asset image read', () => this.assets.readAssetImage(assetId));
  }

  importAssets(sourcePaths: readonly string[]): Promise<AssetImportResult> {
    return this.logFailure('Asset import', () => this.assets.importAssets(sourcePaths));
  }

  renameAsset(assetId: string, newName: string): Promise<ProjectAsset> {
    return this.logFailure('Asset rename', () => this.assets.renameAsset(assetId, newName));
  }

  deleteAsset(assetId: string): Promise<void> {
    return this.logFailure('Asset delete', () => this.assets.deleteAsset(assetId));
  }

  getRecentProjects(): Promise<RecentProject[]> {
    return this.recents.list();
  }

  async removeRecentProject(projectId: string): Promise<void> {
    await this.recents.remove(projectId);
    this.logger.info('Recent project removed', { projectId });
  }

  private async logFailure<T>(label: string, operation: () => Promise<T>): Promise<T> {
    try {
      return await operation();
    } catch (error) {
      this.logger.warn(`${label} failed`, describeError(error));
      throw error;
    }
  }

  /** A failure to remember a project must not prevent using it. */
  private async registerRecent(project: OpenProject): Promise<void> {
    try {
      await this.recents.register({
        projectId: project.metadata.id,
        name: project.metadata.name,
        path: project.path
      });
    } catch (error) {
      this.logger.error('Could not register recent project', describeError(error));
    }
  }
}
