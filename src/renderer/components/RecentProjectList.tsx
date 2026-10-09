import type { RecentProject } from '@shared/types/project';
import type { RecentProjectsState } from '../state/useApplicationHome';
import { RecentProjectItem } from './RecentProjectItem';

interface RecentProjectListProps {
  state: RecentProjectsState;
  disabled: boolean;
  onOpen(project: RecentProject): void;
  onRemove(project: RecentProject): void;
  onRetry(): void;
}

/** Renders the Loading / Error / Empty / Loaded states of the recent-project section. */
export function RecentProjectList({ state, disabled, onOpen, onRemove, onRetry }: RecentProjectListProps) {
  return (
    <section className="recent" aria-labelledby="recent-heading">
      <h2 id="recent-heading">Recent Projects</h2>

      {state.status === 'loading' && (
        <p className="muted" role="status">
          Loading recent projects...
        </p>
      )}

      {state.status === 'error' && (
        <div className="notice notice-error" role="alert">
          <p className="notice-title">Unable to load recent projects.</p>
          <p>{state.message}</p>
          <button type="button" className="button button-small" onClick={onRetry}>
            Try again
          </button>
        </div>
      )}

      {state.status === 'ready' && state.projects.length === 0 && (
        <div className="empty">
          <p className="empty-title">No recent projects</p>
          <p className="muted">Create a new project or open an existing project to get started.</p>
        </div>
      )}

      {state.status === 'ready' && state.projects.length > 0 && (
        <ul className="recent-list">
          {state.projects.map((project) => (
            <RecentProjectItem
              key={project.projectId}
              project={project}
              disabled={disabled}
              onOpen={onOpen}
              onRemove={onRemove}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
