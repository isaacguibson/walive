import { useCallback, useEffect, useRef, useState } from 'react';
import { framesFromAnimationDocument } from '@editor/animation/serialization';
import { EditorSession } from '@editor/editorSession';
import { EditorError } from '@editor/errors';
import type { AnimationAPI, AssetsAPI, ProjectAPI } from '@shared/types/api';
import type { ProjectMetadata } from '@shared/types/project';
import { ConfirmCloseDialog } from '../components/editor/ConfirmCloseDialog';
import { Editor } from '../components/editor/Editor';

interface EditorPageProps {
  api: ProjectAPI;
  animationApi: AnimationAPI;
  assetsApi: AssetsAPI;
  project: ProjectMetadata;
  onClosed(): void;
}

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; session: EditorSession };

/**
 * Loads the stored animation of the open project, shows the editor and
 * coordinates saving and closing through Project Management. The editor never
 * touches files itself.
 */
export function EditorPage({ api, animationApi, assetsApi, project, onClosed }: EditorPageProps) {
  const [load, setLoad] = useState<LoadState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoad({ status: 'loading' });
    void (async () => {
      const result = await animationApi.loadAnimation();
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setLoad({ status: 'error', message: result.error.message });
        return;
      }
      try {
        const { width, height } = project.canvas;
        const frames =
          result.value === null ? undefined : framesFromAnimationDocument(result.value, width, height);
        setLoad({
          status: 'ready',
          session: new EditorSession({
            width,
            height,
            ...(frames !== undefined ? { frames } : {}),
            ...(result.value !== null && result.value.manualReferenceFrameId !== undefined
              ? { manualReferenceFrameId: result.value.manualReferenceFrameId }
              : {})
          })
        });
      } catch (error) {
        setLoad({
          status: 'error',
          message: error instanceof EditorError ? error.message : 'The project drawings could not be opened.'
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [animationApi, project, attempt]);

  const session = load.status === 'ready' ? load.session : null;

  /** Persists the current animation. Resolves to `true` when it was stored. */
  const save = useCallback(async (): Promise<boolean> => {
    if (session === null || savingRef.current) {
      return false;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const { document, token } = session.createSaveRequest();
      const result = await animationApi.saveAnimation(document);
      if (result.ok) {
        session.markSaved(token);
        session.clearError();
        return true;
      }
      session.reportError(`Unable to save drawing data. ${result.error.message}`);
      return false;
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [animationApi, session]);

  const closeProject = useCallback(async () => {
    setClosing(true);
    setCloseError(null);
    session?.stop();
    const result = await api.closeProject();
    if (result.ok) {
      onClosed();
    } else {
      setCloseError(result.error.message);
      setClosing(false);
    }
  }, [api, onClosed, session]);

  function requestClose() {
    if (session !== null && session.getSnapshot().isDirty) {
      session.stop();
      setConfirmClose(true);
      return;
    }
    void closeProject();
  }

  async function saveAndClose() {
    if (await save()) {
      setConfirmClose(false);
      await closeProject();
    } else {
      setConfirmClose(false);
    }
  }

  if (load.status === 'loading') {
    return (
      <main className="editor-status">
        <h1>{project.name}</h1>
        <p className="muted" role="status">
          Loading project…
        </p>
      </main>
    );
  }

  if (load.status === 'error') {
    return (
      <main className="editor-status">
        <h1>{project.name}</h1>
        <p className="form-error" role="alert">
          {load.message}
        </p>
        {closeError !== null && (
          <p className="form-error" role="alert">
            {closeError}
          </p>
        )}
        <div className="home-actions">
          <button type="button" className="button button-primary" onClick={() => setAttempt((value) => value + 1)}>
            Try Again
          </button>
          <button type="button" className="button" disabled={closing} onClick={() => void closeProject()}>
            Close Project
          </button>
        </div>
      </main>
    );
  }

  return (
    <>
      <Editor
        session={load.session}
        assetsApi={assetsApi}
        projectName={project.name}
        saving={saving}
        closing={closing}
        onSave={() => void save()}
        onClose={requestClose}
      />
      {closeError !== null && (
        <p className="form-error editor-toast" role="alert">
          {closeError}
        </p>
      )}
      {confirmClose && (
        <ConfirmCloseDialog
          saving={saving}
          onSave={() => void saveAndClose()}
          onDiscard={() => {
            setConfirmClose(false);
            void closeProject();
          }}
          onCancel={() => setConfirmClose(false)}
        />
      )}
    </>
  );
}
