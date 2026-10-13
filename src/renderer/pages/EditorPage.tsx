import { useState } from 'react';
import type { AnimationAPI, AssetsAPI, ProjectAPI, ScenesAPI } from '@shared/types/api';
import type { ProjectMetadata } from '@shared/types/project';
import { ConfirmCloseDialog } from '../components/editor/ConfirmCloseDialog';
import { ConfirmDeleteSceneDialog } from '../components/editor/ConfirmDeleteSceneDialog';
import { Editor } from '../components/editor/Editor';
import { SceneNameDialog } from '../components/editor/SceneNameDialog';
import { SceneSelector } from '../components/editor/SceneSelector';
import { UnsavedSceneDialog } from '../components/editor/UnsavedSceneDialog';
import { useSceneWorkspace } from '../state/useSceneWorkspace';

interface EditorPageProps {
  api: ProjectAPI;
  animationApi: AnimationAPI;
  assetsApi: AssetsAPI;
  scenesApi: ScenesAPI;
  project: ProjectMetadata;
  onClosed(): void;
}

/** What the user wanted to do when the unsaved-changes dialog interrupted them. */
type PendingLeave = { kind: 'switch'; sceneId: string } | { kind: 'create' };

type SceneDialog = { kind: 'create'; discardCurrent: boolean } | { kind: 'rename' } | { kind: 'delete' };

/**
 * Loads the scenes of the open project, shows the editor of the active one and
 * coordinates saving, scene management and closing. The editor never touches
 * files itself.
 */
export function EditorPage({ api, animationApi, assetsApi, scenesApi, project, onClosed }: EditorPageProps) {
  const workspace = useSceneWorkspace(project, animationApi, scenesApi);
  const { state, saving, busy, save } = workspace;
  const [closing, setClosing] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);
  const [pendingLeave, setPendingLeave] = useState<PendingLeave | null>(null);
  const [sceneDialog, setSceneDialog] = useState<SceneDialog | null>(null);

  const session = state.status === 'ready' ? state.session : null;

  async function closeProject() {
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
  }

  function hasUnsavedChanges(): boolean {
    return session !== null && session.getSnapshot().isDirty;
  }

  function requestClose() {
    if (hasUnsavedChanges()) {
      session?.stop();
      setConfirmClose(true);
      return;
    }
    void closeProject();
  }

  async function saveAndClose() {
    const saved = await save();
    setConfirmClose(false);
    if (saved) {
      await closeProject();
    }
  }

  async function switchScene(sceneId: string, discardCurrent: boolean) {
    const error = await workspace.selectScene(sceneId, discardCurrent);
    if (error !== null) {
      session?.reportError(error);
    }
  }

  function resolveLeave(leave: PendingLeave, discardCurrent: boolean) {
    if (leave.kind === 'switch') {
      void switchScene(leave.sceneId, discardCurrent);
    } else {
      setSceneDialog({ kind: 'create', discardCurrent });
    }
  }

  /** Leaving a scene with unsaved changes first asks what to do with them. */
  function requestLeave(leave: PendingLeave) {
    if (hasUnsavedChanges()) {
      session?.stop();
      setPendingLeave(leave);
    } else {
      resolveLeave(leave, false);
    }
  }

  async function saveAndLeave(leave: PendingLeave) {
    const saved = await save();
    setPendingLeave(null);
    if (saved) {
      resolveLeave(leave, false);
    }
  }

  /** Runs a scene operation and closes the dialog that triggered it once it succeeds. */
  async function finishSceneDialog(operation: Promise<string | null>): Promise<string | null> {
    const error = await operation;
    if (error === null) {
      setSceneDialog(null);
    }
    return error;
  }

  if (state.status === 'loading') {
    return (
      <main className="editor-status">
        <h1>{project.name}</h1>
        <p className="muted" role="status">
          Loading project…
        </p>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="editor-status">
        <h1>{project.name}</h1>
        <p className="form-error" role="alert">
          {state.message}
        </p>
        {closeError !== null && (
          <p className="form-error" role="alert">
            {closeError}
          </p>
        )}
        <div className="home-actions">
          <button type="button" className="button button-primary" onClick={workspace.retry}>
            Try Again
          </button>
          <button type="button" className="button" disabled={closing} onClick={() => void closeProject()}>
            Close Project
          </button>
        </div>
      </main>
    );
  }

  const activeScene = state.scenes.find((scene) => scene.id === state.activeSceneId);

  return (
    <>
      <Editor
        key={state.activeSceneId}
        session={state.session}
        assetsApi={assetsApi}
        projectName={project.name}
        sceneSelector={
          <SceneSelector
            scenes={state.scenes}
            activeSceneId={state.activeSceneId}
            disabled={saving || busy || closing}
            onSelect={(sceneId) => requestLeave({ kind: 'switch', sceneId })}
            onCreate={() => requestLeave({ kind: 'create' })}
            onRename={() => setSceneDialog({ kind: 'rename' })}
            onDelete={() => setSceneDialog({ kind: 'delete' })}
          />
        }
        saving={saving}
        closing={closing || busy}
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
      {pendingLeave !== null && (
        <UnsavedSceneDialog
          saving={saving}
          onSave={() => void saveAndLeave(pendingLeave)}
          onDiscard={() => {
            setPendingLeave(null);
            resolveLeave(pendingLeave, true);
          }}
          onCancel={() => setPendingLeave(null)}
        />
      )}
      {sceneDialog?.kind === 'create' && (
        <SceneNameDialog
          title="New Scene"
          submitLabel="Create Scene"
          initialName=""
          onCancel={() => setSceneDialog(null)}
          onSubmit={(name) => finishSceneDialog(workspace.createScene(name, sceneDialog.discardCurrent))}
        />
      )}
      {sceneDialog?.kind === 'rename' && (
        <SceneNameDialog
          title="Rename Scene"
          submitLabel="Rename Scene"
          initialName={activeScene?.name ?? ''}
          onCancel={() => setSceneDialog(null)}
          onSubmit={(name) => finishSceneDialog(workspace.renameActiveScene(name))}
        />
      )}
      {sceneDialog?.kind === 'delete' && (
        <ConfirmDeleteSceneDialog
          sceneName={activeScene?.name ?? ''}
          onCancel={() => setSceneDialog(null)}
          onConfirm={() => finishSceneDialog(workspace.deleteActiveScene())}
        />
      )}
    </>
  );
}
