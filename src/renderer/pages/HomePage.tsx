import { useState } from 'react';
import type { ProjectAPI } from '@shared/types/api';
import type { ProjectMetadata, RecentProject } from '@shared/types/project';
import { ConfirmRemoveDialog } from '../components/ConfirmRemoveDialog';
import { NewProjectDialog } from '../components/NewProjectDialog';
import { RecentProjectList } from '../components/RecentProjectList';
import { BUSY_MESSAGES, useApplicationHome } from '../state/useApplicationHome';

interface HomePageProps {
  api: ProjectAPI;
  onProjectOpened(project: ProjectMetadata): void;
}

export function HomePage({ api, onProjectOpened }: HomePageProps) {
  const home = useApplicationHome(api, onProjectOpened);
  const [creating, setCreating] = useState(false);
  const [removing, setRemoving] = useState<RecentProject | null>(null);
  const busy = home.busy !== null;

  function requestRemove(project: RecentProject) {
    if (project.available) {
      setRemoving(project);
    } else {
      // Nothing exists on disk for an unavailable project, so no confirmation is needed.
      void home.removeRecentProject(project);
    }
  }

  return (
    <main className="home">
      <header className="home-header">
        <h1>Animation Studio</h1>
        <div className="home-actions">
          <button type="button" className="button button-primary" disabled={busy} onClick={() => setCreating(true)}>
            Create New Project
          </button>
          <button type="button" className="button" disabled={busy} onClick={() => void home.openExistingProject()}>
            Open Existing Project
          </button>
        </div>
      </header>

      {home.busy !== null && !creating && (
        <p className="status" role="status">
          {BUSY_MESSAGES[home.busy]}
        </p>
      )}

      {home.error !== null && (
        <div className="notice notice-error" role="alert">
          <p className="notice-title">{home.error.title}</p>
          <p>{home.error.detail}</p>
          <button type="button" className="button button-small" onClick={home.dismissError}>
            Dismiss
          </button>
        </div>
      )}

      <RecentProjectList
        state={home.recent}
        disabled={busy}
        onOpen={(project) => void home.openRecentProject(project)}
        onRemove={requestRemove}
        onRetry={() => void home.reload()}
      />

      {creating && (
        <NewProjectDialog
          api={api}
          busy={home.busy === 'creating'}
          onCancel={() => setCreating(false)}
          onCreate={home.createProject}
        />
      )}

      {removing !== null && (
        <ConfirmRemoveDialog
          project={removing}
          onCancel={() => setRemoving(null)}
          onConfirm={() => {
            const target = removing;
            setRemoving(null);
            void home.removeRecentProject(target);
          }}
        />
      )}
    </main>
  );
}
