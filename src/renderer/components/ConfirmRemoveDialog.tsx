import type { RecentProject } from '@shared/types/project';
import { Dialog } from './Dialog';

interface ConfirmRemoveDialogProps {
  project: RecentProject;
  onCancel(): void;
  onConfirm(): void;
}

export function ConfirmRemoveDialog({ project, onCancel, onConfirm }: ConfirmRemoveDialogProps) {
  return (
    <Dialog title={`Remove "${project.name}" from recent projects?`} titleId="confirm-remove-title" onCancel={onCancel}>
      <p>This will not delete the project from your computer.</p>
      <div className="dialog-actions">
        <button type="button" className="button" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button button-danger" onClick={onConfirm}>
          Remove
        </button>
      </div>
    </Dialog>
  );
}
