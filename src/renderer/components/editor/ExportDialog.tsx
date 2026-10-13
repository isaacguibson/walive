import { useEffect, useState } from 'react';
import type { EditorSession } from '@editor/editorSession';
import type { ExportAPI } from '@shared/types/api';
import type { AnimationFormatId, ExportProgress, ExportRequest, ExportResult } from '@shared/types/export';
import { useEditorSnapshot } from '../../state/useEditorSnapshot';
import {
  buildDestinationQuery,
  defaultSettings,
  planRequest,
  summarize,
  withDimension,
  type ExportContext,
  type ExportSettings
} from '../../state/exportSettings';
import { Dialog } from '../Dialog';
import { ExportSettingsForm } from './ExportSettingsForm';

interface ExportDialogProps {
  session: EditorSession;
  exportApi: ExportAPI;
  projectName: string;
  sceneName: string;
  /** Saves the open scene; resolves to `false` when saving failed. */
  onSave(): Promise<boolean>;
  onClose(): void;
}

type Phase =
  | { name: 'configure' }
  | { name: 'running'; destination: string; cancelling: boolean }
  | { name: 'conflict'; request: ExportRequest; destination: string; message: string }
  | { name: 'done'; result: ExportResult };

type Message = { kind: 'error' | 'info'; text: string };

const TITLES: Record<Phase['name'], string> = {
  configure: 'Export',
  running: 'Exporting…',
  conflict: 'Replace Existing Files?',
  done: 'Export Complete'
};

function progressText({ stage, current, total, sceneName }: ExportProgress): string {
  if (stage === 'finalizing') {
    return 'Finalizing the export…';
  }
  const scene = sceneName === null ? '' : ` of ${sceneName}`;
  return `Rendered frame ${current} of ${total}${scene}`;
}

/** Export workflow: choose settings, pick the destination, follow the progress and see the result. */
export function ExportDialog({ session, exportApi, projectName, sceneName, onSave, onClose }: ExportDialogProps) {
  const snapshot = useEditorSnapshot(session);
  const context: ExportContext = {
    projectName,
    sceneName,
    canvasWidth: snapshot.width,
    canvasHeight: snapshot.height,
    frameCount: snapshot.frames.length,
    activeFrameId: snapshot.activeFrame.id,
    activeFrameNumber: snapshot.frames.findIndex((frame) => frame.id === snapshot.activeFrame.id) + 1,
    sceneFps: snapshot.state.fps
  };
  const [settings, setSettings] = useState(() => defaultSettings(context));
  const [formats, setFormats] = useState<readonly AnimationFormatId[] | null>(null);
  const [phase, setPhase] = useState<Phase>({ name: 'configure' });
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => exportApi.onProgress(setProgress), [exportApi]);

  useEffect(() => {
    let active = true;
    void exportApi.getCapabilities().then((result) => {
      if (!active) {
        return;
      }
      // GIF is produced by the application itself, so it stays available if the check fails.
      const available: readonly AnimationFormatId[] = result.ok ? result.value.animationFormats : ['gif'];
      setFormats(available);
      setSettings((current) => (available.includes(current.format) ? current : { ...current, format: available[0] ?? 'gif' }));
    });
    return () => {
      active = false;
    };
  }, [exportApi]);

  const update = (patch: Partial<ExportSettings>) => setSettings((current) => ({ ...current, ...patch }));

  function backToSettings(next: Message | null) {
    setMessage(next);
    setBusy(false);
    setPhase({ name: 'configure' });
  }

  async function run(request: ExportRequest, destination: string) {
    setProgress(null);
    setPhase({ name: 'running', destination, cancelling: false });
    const result = await exportApi.startExport(request);
    if (result.ok) {
      setBusy(false);
      setPhase({ name: 'done', result: result.value });
    } else if (result.error.code === 'EXPORT_CONFLICT') {
      setPhase({ name: 'conflict', request, destination, message: result.error.message });
    } else if (result.error.code === 'EXPORT_CANCELLED') {
      backToSettings({ kind: 'info', text: 'The export was cancelled. No output was created.' });
    } else {
      backToSettings({ kind: 'error', text: result.error.message });
    }
  }

  async function start() {
    const plan = planRequest(settings, context);
    if (plan.error !== null) {
      setMessage({ kind: 'error', text: plan.error });
      return;
    }
    setBusy(true);
    setMessage(null);
    const chosen = await exportApi.chooseDestination(buildDestinationQuery(settings, context));
    if (!chosen.ok) {
      backToSettings({ kind: 'error', text: chosen.error.message });
      return;
    }
    if (chosen.value === null) {
      setBusy(false);
      return;
    }
    // Exports read the saved scene, so unsaved edits are saved first.
    if (snapshot.isDirty && !(await onSave())) {
      backToSettings({ kind: 'error', text: 'The scene could not be saved, so nothing was exported. Try saving again.' });
      return;
    }
    await run(plan.build(chosen.value.id, false), chosen.value.path);
  }

  async function cancel() {
    setPhase((current) => (current.name === 'running' ? { ...current, cancelling: true } : current));
    await exportApi.cancelExport();
  }

  async function reveal() {
    const result = await exportApi.revealOutput();
    if (!result.ok) {
      setMessage({ kind: 'error', text: result.error.message });
    }
  }

  const feedback = message !== null && (
    <p className={message.kind === 'error' ? 'form-error' : 'form-status'} role={message.kind === 'error' ? 'alert' : 'status'}>
      {message.text}
    </p>
  );

  return (
    <Dialog
      key={phase.name}
      title={TITLES[phase.name]}
      titleId="export-title"
      className="dialog-wide"
      onCancel={() => phase.name !== 'running' && onClose()}
    >
      {phase.name === 'configure' && (
        <>
          <ExportSettingsForm
            settings={settings}
            context={context}
            formats={formats}
            disabled={busy}
            onChange={update}
            onDimensionChange={(side, value) => setSettings((current) => withDimension(current, context, side, value))}
          />
          <dl className="export-summary" aria-label="Export summary">
            {summarize(settings, context).map(([label, value]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          {snapshot.isDirty && <p className="form-status">This scene has unsaved changes. They will be saved before exporting.</p>}
          {feedback}
          <div className="dialog-actions">
            <button type="button" className="button" disabled={busy} onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="button button-primary" disabled={busy || (settings.kind === 'animation' && formats === null)} onClick={() => void start()}>
              {snapshot.isDirty ? 'Save and Export…' : 'Export…'}
            </button>
          </div>
        </>
      )}

      {phase.name === 'running' && (
        <>
          <p>
            Exporting to <code className="export-path">{phase.destination}</code>
          </p>
          <progress
            className="export-progress"
            aria-label="Export progress"
            {...(progress !== null && progress.stage === 'rendering' ? { max: progress.total, value: progress.current } : {})}
          />
          <p className="form-status" role="status">
            {progress === null ? 'Preparing the export…' : progressText(progress)}
          </p>
          <div className="dialog-actions">
            <button type="button" className="button" disabled={phase.cancelling} onClick={() => void cancel()}>
              {phase.cancelling ? 'Cancelling…' : 'Cancel Export'}
            </button>
          </div>
        </>
      )}

      {phase.name === 'conflict' && (
        <>
          <p>{phase.message}</p>
          <p className="muted">Replacing overwrites the existing files at the destination.</p>
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => backToSettings(null)}>
              Back
            </button>
            <button type="button" className="button button-danger" onClick={() => void run({ ...phase.request, overwrite: true }, phase.destination)}>
              Replace
            </button>
          </div>
        </>
      )}

      {phase.name === 'done' && (
        <>
          <p role="status">
            {phase.result.fileCount === 1 ? '1 file was' : `${phase.result.fileCount} files were`} exported to{' '}
            <code className="export-path">{phase.result.outputPath}</code>
          </p>
          {phase.result.warning !== undefined && <p className="form-status">{phase.result.warning}</p>}
          {feedback}
          <div className="dialog-actions">
            <button type="button" className="button" onClick={() => void reveal()}>
              Show in Folder
            </button>
            <button type="button" className="button button-primary" onClick={onClose}>
              Close
            </button>
          </div>
        </>
      )}
    </Dialog>
  );
}
