import type { RecentProjectsService } from './recentProjectsService';
import { AssetService } from '../assets/assetService';
import { describeError, silentLogger, type Logger } from '../logger';
import type { ProjectService } from '../project/projectService';
import type { OpenProject } from '../project/types';
import type { AnimationDocument } from '@shared/types/animation';
import type { AssetImportResult, ProjectAsset } from '@shared/types/assets';
import type { ProjectCanvas, ProjectMetadata, RecentProject } from '@shared/types/project';

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

  /** Stored animation of the open project, or `null` when nothing was saved yet. */
  async loadAnimation(): Promise<AnimationDocument | null> {
    try {
      return await this.projects.loadAnimation();
    } catch (error) {
      this.logger.warn('Animation load failed', describeError(error));
      throw error;
    }
  }

  async saveAnimation(document: unknown): Promise<void> {
    try {
      await this.projects.saveAnimation(document);
      this.logger.info('Animation saved');
    } catch (error) {
      this.logger.warn('Animation save failed', describeError(error));
      throw error;
    }
  }

  listAssets(): Promise<ProjectAsset[]> {
    return this.runAssetOperation('Asset list', () => this.assets.listAssets());
  }

  readAssetImage(assetId: string): Promise<string> {
    return this.runAssetOperation('Asset image read', () => this.assets.readAssetImage(assetId));
  }

  importAssets(sourcePaths: readonly string[]): Promise<AssetImportResult> {
    return this.runAssetOperation('Asset import', () => this.assets.importAssets(sourcePaths));
  }

  renameAsset(assetId: string, newName: string): Promise<ProjectAsset> {
    return this.runAssetOperation('Asset rename', () => this.assets.renameAsset(assetId, newName));
  }

  deleteAsset(assetId: string): Promise<void> {
    return this.runAssetOperation('Asset delete', () => this.assets.deleteAsset(assetId));
  }

  getRecentProjects(): Promise<RecentProject[]> {
    return this.recents.list();
  }

  async removeRecentProject(projectId: string): Promise<void> {
    await this.recents.remove(projectId);
    this.logger.info('Recent project removed', { projectId });
  }

  private async runAssetOperation<T>(label: string, operation: () => Promise<T>): Promise<T> {
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
