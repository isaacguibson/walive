import type { RecentProjectEntry, RecentProjectRepository } from './recentProjectRepository';
import type { ProjectService } from '../project/projectService';
import type { RecentProject } from '@shared/types/project';

export interface RegisterProjectInput {
  projectId: string;
  name: string;
  path: string;
}

function byLastOpenedDesc(a: RecentProjectEntry, b: RecentProjectEntry): number {
  return Date.parse(b.lastOpenedAt) - Date.parse(a.lastOpenedAt);
}

/** Maintains the application-level list of recently opened projects. */
export class RecentProjectsService {
  /** Serializes read-modify-write cycles so concurrent calls cannot lose updates. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly repository: RecentProjectRepository,
    private readonly projects: Pick<ProjectService, 'validateProject'>,
    private readonly now: () => Date = () => new Date()
  ) {}

  /** Adds or refreshes a project; the same project ID never appears twice. */
  register(project: RegisterProjectInput): Promise<void> {
    return this.mutate((entries) => {
      const others = entries.filter((entry) => entry.projectId !== project.projectId && entry.path !== project.path);
      return [...others, { ...project, lastOpenedAt: this.now().toISOString() }];
    });
  }

  /** Removes only the registry entry; project files are never touched. */
  remove(projectId: string): Promise<void> {
    return this.mutate((entries) => entries.filter((entry) => entry.projectId !== projectId));
  }

  /** Returns entries ordered by `lastOpenedAt` descending, with availability resolved. */
  async list(): Promise<RecentProject[]> {
    const entries = [...(await this.repository.load())].sort(byLastOpenedDesc);
    return Promise.all(
      entries.map(async (entry) => ({ ...entry, available: await this.isAvailable(entry) }))
    );
  }

  private async isAvailable(entry: RecentProjectEntry): Promise<boolean> {
    try {
      const result = await this.projects.validateProject(entry.path);
      return result.valid && result.metadata.id === entry.projectId;
    } catch {
      return false;
    }
  }

  private mutate(change: (entries: RecentProjectEntry[]) => RecentProjectEntry[]): Promise<void> {
    const run = async (): Promise<void> => {
      const next = change(await this.repository.load()).sort(byLastOpenedDesc);
      await this.repository.save(next);
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}
