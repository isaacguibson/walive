import { useState } from 'react';
import { Dialog } from '../Dialog';

interface ConfirmDeleteSceneDialogProps {
  sceneName: string;
  onCancel(): void;
  /** Resolves to an error message to display, or `null` when the scene was deleted. */
  onConfirm(): Promise<string | null>;
}

/** Confirms the permanent removal of the active scene. */
export function ConfirmDeleteSceneDialog({ sceneName, onCancel, onConfirm }: ConfirmDeleteSceneDialogProps) {
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function confirm() {
    setDeleting(true);
    setError(null);
    const message = await onConfirm();
    if (message !== null) {
      setError(message);
      setDeleting(false);
    }
  }

  return (
    <Dialog title="Delete scene?" titleId="delete-scene-title" onCancel={onCancel}>
      <p>
        “{sceneName}” and all of its frames will be deleted permanently. This cannot be undone.
      </p>
      {error !== null && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <button type="button" className="button" disabled={deleting} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button button-danger" disabled={deleting} onClick={() => void confirm()}>
          {deleting ? 'Deleting…' : 'Delete Scene'}
        </button>
      </div>
    </Dialog>
  );
}
