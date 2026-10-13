import { Dialog } from '../Dialog';

interface UnsavedSceneDialogProps {
  saving: boolean;
  onSave(): void;
  onDiscard(): void;
  onCancel(): void;
}

/** Shown when the user leaves a scene that has unsaved changes. */
export function UnsavedSceneDialog({ saving, onSave, onDiscard, onCancel }: UnsavedSceneDialogProps) {
  return (
    <Dialog title="Save changes before leaving this scene?" titleId="unsaved-scene-title" onCancel={onCancel}>
      <p>Your changes will be lost if you do not save them.</p>
      <div className="dialog-actions">
        <button type="button" className="button" disabled={saving} onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="button button-danger" disabled={saving} onClick={onDiscard}>
          Discard and Switch
        </button>
        <button type="button" className="button button-primary" disabled={saving} onClick={onSave}>
          {saving ? 'Saving…' : 'Save and Switch'}
        </button>
      </div>
    </Dialog>
  );
}
