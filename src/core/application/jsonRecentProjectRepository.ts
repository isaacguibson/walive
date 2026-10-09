import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { RecentProjectEntry, RecentProjectRepository } from './recentProjectRepository';
import { AppError, isNodeError } from '../errors';

const STATE_FORMAT_VERSION = 1;

interface StateFile {
  version: number;
  recentProjects: RecentProjectEntry[];
}

function isEntry(value: unknown): value is RecentProjectEntry {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.projectId === 'string' &&
    typeof entry.name === 'string' &&
    typeof entry.path === 'string' &&
    typeof entry.lastOpenedAt === 'string'
  );
}

/** Stores the recent-project registry as a JSON file in the application data directory. */
export class JsonRecentProjectRepository implements RecentProjectRepository {
  constructor(private readonly filePath: string) {}

  async load(): Promise<RecentProjectEntry[]> {
    let text: string;
    try {
      text = await fs.readFile(this.filePath, 'utf8');
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') {
        return [];
      }
      throw new AppError('STATE_READ_FAILED', 'Recent projects could not be loaded.', { cause: error });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      await this.quarantineCorruptFile();
      return [];
    }

    const list = (parsed as Partial<StateFile> | null)?.recentProjects;
    return Array.isArray(list) ? list.filter(isEntry) : [];
  }

  async save(entries: RecentProjectEntry[]): Promise<void> {
    const state: StateFile = { version: STATE_FORMAT_VERSION, recentProjects: entries };
    const temp = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const handle = await fs.open(temp, 'w');
      try {
        await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`, 'utf8');
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(temp, this.filePath);
    } catch (error) {
      await fs.rm(temp, { force: true }).catch(() => undefined);
      throw new AppError('STATE_WRITE_FAILED', 'Recent projects could not be saved.', { cause: error });
    }
  }

  /** A damaged registry must not lock the user out: keep a copy and start fresh. */
  private async quarantineCorruptFile(): Promise<void> {
    await fs.rename(this.filePath, `${this.filePath}.corrupt`).catch(() => undefined);
  }
}
