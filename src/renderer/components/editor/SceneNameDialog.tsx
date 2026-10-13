import { useState, type FormEvent } from 'react';
import { Dialog } from '../Dialog';

/** Matches the limit enforced by the main process. */
const MAX_NAME_LENGTH = 100;

interface SceneNameDialogProps {
  title: string;
  submitLabel: string;
  initialName: string;
  onCancel(): void;
  /** Resolves to an error message to display, or `null` when the scene was saved. */
  onSubmit(name: string): Promise<string | null>;
}

/** Asks for a scene name and keeps the typed text visible when the name is rejected. */
export function SceneNameDialog({ title, submitLabel, initialName, onCancel, onSubmit }: SceneNameDialogProps) {
  const [name, setName] = useState(initialName);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    const message = await onSubmit(name);
    if (message !== null) {
      setError(message);
      setSubmitting(false);
    }
  }

  return (
    <Dialog title={title} titleId="scene-name-title" onCancel={onCancel}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor="scene-name">Scene name</label>
          <input
            id="scene-name"
            value={name}
            maxLength={MAX_NAME_LENGTH}
            autoComplete="off"
            aria-invalid={error !== null}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {error !== null && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="button" disabled={submitting} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={submitting}>
            {submitLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
