import type { RecentProject } from '@shared/types/project';
import { formatLastOpened } from '../services/formatLastOpened';

interface RecentProjectItemProps {
  project: RecentProject;
  disabled: boolean;
  onOpen(project: RecentProject): void;
  onRemove(project: RecentProject): void;
}

export function RecentProjectItem({ project, disabled, onOpen, onRemove }: RecentProjectItemProps) {
  const lastOpened = formatLastOpened(project.lastOpenedAt);

  if (!project.available) {
    return (
      <li className="recent-item recent-item-unavailable">
        <div className="recent-info">
          <span className="recent-name">{project.name}</span>
          <span className="badge badge-warning">Unavailable</span>
          <p className="recent-warning">The project could not be found at its previous location.</p>
          <span className="recent-path">{project.path}</span>
        </div>
        <button
          type="button"
          className="button button-small"
          disabled={disabled}
          aria-label={`Remove ${project.name} from recent projects`}
          onClick={() => onRemove(project)}
        >
          Remove
        </button>
      </li>
    );
  }

  return (
    <li className="recent-item">
      <button
        type="button"
        className="recent-open"
        disabled={disabled}
        aria-label={`Open ${project.name}`}
        onClick={() => onOpen(project)}
      >
        <span className="recent-name">{project.name}</span>
        <span className="recent-path">{project.path}</span>
        <span className="recent-date">Last opened: {lastOpened}</span>
      </button>
      <button
        type="button"
        className="button button-small"
        disabled={disabled}
        aria-label={`Remove ${project.name} from recent projects`}
        onClick={() => onRemove(project)}
      >
        Remove
      </button>
    </li>
  );
}
