import { useCallback, useEffect, useRef, useState } from 'react';
import { framesFromAnimationDocument } from '@editor/animation/serialization';
import { EditorSession } from '@editor/editorSession';
import { EditorError } from '@editor/errors';
import type { AnimationAPI, ScenesAPI } from '@shared/types/api';
import type { AnimationDocument } from '@shared/types/animation';
import type { ProjectMetadata } from '@shared/types/project';
import type { SceneCollection, SceneInfo } from '@shared/types/scenes';

export interface Workspace {
  scenes: SceneInfo[];
  activeSceneId: string;
  /** Editing state of the active scene. */
  session: EditorSession;
}

export type WorkspaceState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | ({ status: 'ready' } & Workspace);

type Opened = { session: EditorSession } | { message: string };

const BUSY_MESSAGE = 'Another operation is still in progress. Try again in a moment.';

function createSession(project: ProjectMetadata, document: AnimationDocument | null): EditorSession {
  const { width, height } = project.canvas;
  if (document === null) {
    return new EditorSession({ width, height });
  }
  return new EditorSession({
    width,
    height,
    frames: framesFromAnimationDocument(document, width, height),
    ...(document.manualReferenceFrameId !== undefined ? { manualReferenceFrameId: document.manualReferenceFrameId } : {})
  });
}

/**
 * Scenes of the open project and the editing session of the active one. Only
 * the active session may have unsaved changes: callers resolve them (save or
 * discard) before leaving a scene. Sessions of clean scenes are kept, so
 * returning to a scene restores its undo history and view settings.
 *
 * Every operation that can fail resolves to an error message (or `null`), so
 * the user keeps the current scene whenever something goes wrong.
 */
export function useSceneWorkspace(project: ProjectMetadata, animationApi: AnimationAPI, scenesApi: ScenesAPI) {
  const [state, setState] = useState<WorkspaceState>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);
  const [saving, setSaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const sessions = useRef(new Map<string, EditorSession>());
  const savingRef = useRef(false);
  const busyRef = useRef(false);

  const openScene = useCallback(
    async (sceneId: string): Promise<Opened> => {
      const cached = sessions.current.get(sceneId);
      if (cached !== undefined) {
        return { session: cached };
      }
      const result = await animationApi.loadAnimation(sceneId);
      if (!result.ok) {
        return { message: result.error.message };
      }
      try {
        const session = createSession(project, result.value);
        sessions.current.set(sceneId, session);
        return { session };
      } catch (error) {
        return { message: error instanceof EditorError ? error.message : 'The scene drawings could not be opened.' };
      }
    },
    [animationApi, project]
  );

  useEffect(() => {
    let cancelled = false;
    sessions.current.clear();
    setState({ status: 'loading' });
    void (async () => {
      const listed = await scenesApi.listScenes();
      if (cancelled) {
        return;
      }
      if (!listed.ok) {
        setState({ status: 'error', message: listed.error.message });
        return;
      }
      const opened = await openScene(listed.value.activeSceneId);
      if (!cancelled) {
        setState('message' in opened ? { status: 'error', message: opened.message } : { status: 'ready', ...listed.value, session: opened.session });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [scenesApi, openScene, attempt]);

  /** Runs a scene operation unless another one (or a save) is running. */
  async function exclusive(operation: () => Promise<string | null>): Promise<string | null> {
    if (busyRef.current || savingRef.current) {
      return BUSY_MESSAGE;
    }
    busyRef.current = true;
    setBusy(true);
    try {
      return await operation();
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  /** Makes `session` the active one, forgetting the editing state of `discardedSceneId` when given. */
  function activate(collection: SceneCollection, session: EditorSession, discardedSceneId: string | null) {
    if (discardedSceneId !== null) {
      sessions.current.delete(discardedSceneId);
    }
    setState({ status: 'ready', ...collection, session });
  }

  /** Persists the active scene. Resolves to `true` when it was stored. */
  const save = useCallback(async (): Promise<boolean> => {
    if (state.status !== 'ready' || savingRef.current || busyRef.current) {
      return false;
    }
    const { session, activeSceneId } = state;
    savingRef.current = true;
    setSaving(true);
    try {
      const { document, token } = session.createSaveRequest();
      const result = await animationApi.saveAnimation(activeSceneId, document);
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
  }, [animationApi, state]);

  /** Switches to another scene. `discardCurrent` drops the editing state of the scene being left. */
  function selectScene(sceneId: string, discardCurrent: boolean): Promise<string | null> {
    return exclusive(async () => {
      if (state.status !== 'ready' || sceneId === state.activeSceneId) {
        return null;
      }
      state.session.stop();
      const opened = await openScene(sceneId);
      if ('message' in opened) {
        return opened.message;
      }
      const selected = await scenesApi.selectScene(sceneId);
      if (!selected.ok) {
        return selected.error.message;
      }
      activate(selected.value, opened.session, discardCurrent ? state.activeSceneId : null);
      return null;
    });
  }

  /** Creates an empty scene and switches to it. */
  function createScene(name: string, discardCurrent: boolean): Promise<string | null> {
    return exclusive(async () => {
      if (state.status !== 'ready') {
        return null;
      }
      const created = await scenesApi.createScene(name);
      if (!created.ok) {
        return created.error.message;
      }
      state.session.stop();
      const session = createSession(project, null);
      sessions.current.set(created.value.activeSceneId, session);
      activate(created.value, session, discardCurrent ? state.activeSceneId : null);
      return null;
    });
  }

  function renameActiveScene(name: string): Promise<string | null> {
    return exclusive(async () => {
      if (state.status !== 'ready') {
        return null;
      }
      const renamed = await scenesApi.renameScene(state.activeSceneId, name);
      if (!renamed.ok) {
        return renamed.error.message;
      }
      setState({ ...state, ...renamed.value });
      return null;
    });
  }

  /** Deletes the active scene together with its editing state; the main process picks the next one. */
  function deleteActiveScene(): Promise<string | null> {
    return exclusive(async () => {
      if (state.status !== 'ready') {
        return null;
      }
      state.session.stop();
      const deleted = await scenesApi.deleteScene(state.activeSceneId);
      if (!deleted.ok) {
        return deleted.error.message;
      }
      sessions.current.delete(state.activeSceneId);
      const opened = await openScene(deleted.value.activeSceneId);
      if ('message' in opened) {
        // The scene is gone for good; Try Again reloads the project from what is stored.
        setState({ status: 'error', message: opened.message });
        return null;
      }
      activate(deleted.value, opened.session, null);
      return null;
    });
  }

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  return { state, saving, busy, save, selectScene, createScene, renameActiveScene, deleteActiveScene, retry };
}
