import { Dialog } from '../Dialog';

interface ConfirmCloseDialogProps {
  saving: boolean;
  onSave(): void;
  onDiscard(): void;
  onCancel(): void;
}

/** Shown when the project is closed while it has unsaved changes (HU_00004 §64). */
export function ConfirmCloseDialog({ saving, onSave, onDiscard, onCancel }: ConfirmCloseDialogProps) {
  return (
    <Dialog title="Save changes before closing?" titleId="confirm-close-title" onCancel={onCancel}>
      <p>Your changes will be lost if you do not save them.</p>
      <div className="dialog-actions">
        <button type="button" className="button" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button button-danger" disabled={saving} onClick={onDiscard}>
          Discard Changes
        </button>
        <button type="button" className="button button-primary" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save and Close'}
        </button>
      </div>
    </Dialog>
  );
}
