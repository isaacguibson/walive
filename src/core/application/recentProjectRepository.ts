/** Application-level reference to a project. Not project data. */
export interface RecentProjectEntry {
  projectId: string;
  name: string;
  path: string;
  lastOpenedAt: string;
}

/**
 * Storage abstraction for the recent-project registry so the persistence
 * mechanism (JSON today, SQLite later) can be replaced without touching callers.
 */
export interface RecentProjectRepository {
  load(): Promise<RecentProjectEntry[]>;
  save(entries: RecentProjectEntry[]): Promise<void>;
}
