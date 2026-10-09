import { useCallback, useEffect, useRef, useState } from 'react';
import type { ProjectAPI } from '@shared/types/api';
import type { IpcResult } from '@shared/types/errors';
import type { ProjectMetadata, RecentProject } from '@shared/types/project';

export type RecentProjectsState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; projects: RecentProject[] };

export interface OperationError {
  title: string;
  detail: string;
}

export type BusyOperation = 'creating' | 'opening' | 'removing';

export const BUSY_MESSAGES: Record<BusyOperation, string> = {
  creating: 'Creating project...',
  opening: 'Opening project...',
  removing: 'Removing project from recent projects...'
};

export interface ApplicationHome {
  recent: RecentProjectsState;
  busy: BusyOperation | null;
  error: OperationError | null;
  dismissError(): void;
  reload(): Promise<void>;
  /** Resolves to an error message to show in the dialog, or `null` on success. */
  createProject(name: string, location: string, canvas?: { width: number; height: number; keepAspectRatio: boolean; aspectRatio?: { width: number; height: number } }): Promise<string | null>;
  openExistingProject(): Promise<void>;
  openRecentProject(project: RecentProject): Promise<void>;
  removeRecentProject(project: RecentProject): Promise<void>;
}

/**
 * Presentation state and actions of the Application Home. All project work is
 * delegated to the preload API; nothing here touches the filesystem.
 */
export function useApplicationHome(api: ProjectAPI, onProjectOpened: (project: ProjectMetadata) => void): ApplicationHome {
  const [recent, setRecent] = useState<RecentProjectsState>({ status: 'loading' });
  const [busy, setBusy] = useState<BusyOperation | null>(null);
  const [error, setError] = useState<OperationError | null>(null);
  // A ref (not state) so rapid repeated clicks are rejected synchronously.
  const busyRef = useRef<BusyOperation | null>(null);

  const reload = useCallback(async () => {
    setRecent({ status: 'loading' });
    const result = await api.getRecentProjects();
    setRecent(
      result.ok
        ? { status: 'ready', projects: result.value }
        : { status: 'error', message: result.error.message }
    );
  }, [api]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = useCallback(async <T,>(operation: BusyOperation, task: () => Promise<T>): Promise<T | undefined> => {
    if (busyRef.current !== null) {
      return undefined;
    }
    busyRef.current = operation;
    setBusy(operation);
    try {
      return await task();
    } finally {
      busyRef.current = null;
      setBusy(null);
    }
  }, []);

  const handleOpenResult = useCallback(
    async (result: IpcResult<ProjectMetadata | null>) => {
      if (!result.ok) {
        setError({ title: 'Unable to open project.', detail: result.error.message });
        await reload();
        return;
      }
      if (result.value !== null) {
        onProjectOpened(result.value);
      }
    },
    [onProjectOpened, reload]
  );

  return {
    recent,
    busy,
    error,
    dismissError: () => setError(null),
    reload,
    async createProject(name, location, canvas) {
      const outcome = await run('creating', async () => {
        const result = await api.createProject(name, location, canvas);
        if (result.ok) {
          setError(null);
          onProjectOpened(result.value);
          return null;
        }
        return result.error.message;
      });
      return outcome ?? null;
    },
    async openExistingProject() {
      await run('opening', async () => {
        setError(null);
        await handleOpenResult(await api.openProject());
      });
    },
    async openRecentProject(project) {
      await run('opening', async () => {
        setError(null);
        await handleOpenResult(await api.openProject(project.path));
      });
    },
    async removeRecentProject(project) {
      await run('removing', async () => {
        setError(null);
        const result = await api.removeRecentProject(project.projectId);
        if (!result.ok) {
          setError({ title: 'Unable to remove project.', detail: result.error.message });
        }
        await reload();
      });
    }
  };
}
