import { useSyncExternalStore } from 'react';
import type { EditorSession, EditorSnapshot } from '@editor/editorSession';

/** Subscribes a component to the editor session; re-renders when anything shown by the snapshot changes. */
export function useEditorSnapshot(session: EditorSession): EditorSnapshot {
  return useSyncExternalStore(session.subscribe, session.getSnapshot);
}
