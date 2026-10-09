import { useEffect, useRef, useState } from 'react';
import type { EditorSession } from '@editor/editorSession';
import { matchShortcut } from '@editor/shortcuts/shortcuts';
import { useEditorSnapshot } from '../../state/useEditorSnapshot';
import { CanvasWorkspace } from './CanvasWorkspace';
import { LayerPanel } from './LayerPanel';
import { PlaybackBar } from './PlaybackBar';
import { Timeline } from './Timeline';
import { ToolOptions } from './ToolOptions';
import { ToolPanel } from './ToolPanel';
import { IconButton } from './IconButton';

interface EditorProps {
  session: EditorSession;
  projectName: string;
  saving: boolean;
  closing: boolean;
  onSave(): void;
  onClose(): void;
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'number', 'search', 'email', 'url', 'tel', 'password']);

/** True for elements where Ctrl+C/V/X/Z must keep their native text behavior. */
function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement || target.isContentEditable) {
    return true;
  }
  return target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type);
}

/** The four editor areas plus the project header. Owns shortcuts and fullscreen, never persistence. */
export function Editor({ session, projectName, saving, closing, onSave, onClose }: EditorProps) {
  const snapshot = useEditorSnapshot(session);
  const { state } = snapshot;
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  // Stop playback and release timers when the editor goes away.
  useEffect(() => () => session.dispose(), [session]);

  // Keyboard shortcuts are defined in one place (shortcuts.ts); this only dispatches them.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && document.fullscreenElement === rootRef.current) {
        void document.exitFullscreen?.();
        return;
      }
      if (isTextEditingTarget(event.target)) {
        return;
      }
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]') !== null) {
        return;
      }
      const action = matchShortcut(event);
      if (action === null) {
        return;
      }
      event.preventDefault();
      if (action === 'project.save') {
        onSaveRef.current();
      } else {
        session.runShortcut(action);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session]);

  // Fullscreen can also end through the browser (Esc), so the state is read back from the document.
  useEffect(() => {
    const sync = () => setIsFullscreen(document.fullscreenElement !== null && document.fullscreenElement === rootRef.current);
    document.addEventListener('fullscreenchange', sync);
    return () => {
      document.removeEventListener('fullscreenchange', sync);
      if (document.fullscreenElement !== null && document.fullscreenElement === rootRef.current) {
        void document.exitFullscreen?.();
      }
    };
  }, []);

  function toggleFullscreen() {
    if (document.fullscreenElement !== null && document.fullscreenElement !== undefined) {
      void document.exitFullscreen?.();
      return;
    }
    const root = rootRef.current;
    if (root === null || typeof root.requestFullscreen !== 'function') {
      session.reportError('Fullscreen is not available.');
      return;
    }
    root.requestFullscreen().catch(() => session.reportError('Fullscreen could not be started.'));
  }

  const playing = state.isPlaying;

  return (
    <div ref={rootRef} className={isFullscreen ? 'editor is-fullscreen' : 'editor'}>
      {!isFullscreen && (
        <header className="editor-header">
          <h1 className="editor-title">{projectName}</h1>
          <span
            className={snapshot.isDirty ? 'save-status is-dirty' : 'save-status'}
            role="status"
            title={snapshot.isDirty ? 'There are unsaved changes' : 'All changes are saved'}
          >
            {saving ? 'Saving…' : snapshot.isDirty ? 'Unsaved changes' : 'All changes saved'}
          </span>
          <div className="editor-header-actions">
            <IconButton
              icon="save"
              label="Save Project"
              variant="default"
              text="Save"
              disabled={saving || closing}
              onClick={onSave}
            />
            <button
              type="button"
              className="button button-small"
              title="Close Project"
              disabled={closing || saving}
              onClick={onClose}
            >
              Close Project
            </button>
          </div>
        </header>
      )}

      {snapshot.error !== null && (
        <div className="editor-error" role="alert">
          <span>{snapshot.error}</span>
          <IconButton icon="close" label="Dismiss Message" size={14} onClick={() => session.clearError()} />
        </div>
      )}

      <div className="editor-body">
        <ToolPanel
          selectedTool={state.selectedTool}
          disabled={playing}
          canUndo={snapshot.canUndo && !playing}
          canRedo={snapshot.canRedo && !playing}
          onSelect={(tool) => session.selectTool(tool)}
          onUndo={() => session.undo()}
          onRedo={() => session.redo()}
        />

        <main className="editor-center">
          <PlaybackBar
            state={state}
            isFullscreen={isFullscreen}
            canPlay={snapshot.frames.length > 0}
            onTogglePlayback={() => session.togglePlayback()}
            onLoopChange={(loop) => session.setLoop(loop)}
            onFpsChange={(fps) => session.setFps(fps)}
            onZoomChange={(zoom) => session.setZoom(zoom)}
            onToggleFullscreen={toggleFullscreen}
          />
          <CanvasWorkspace session={session} snapshot={snapshot} />
        </main>

        <aside className="editor-right">
          <ToolOptions
            state={state}
            onColorChange={(color) => session.setColor(color)}
            onBrushSizeChange={(size) => session.setBrushSize(size)}
            onEraserSizeChange={(size) => session.setEraserSize(size)}
          />
          <LayerPanel
            layers={snapshot.activeFrame.layers}
            activeLayerId={state.activeLayerId ?? snapshot.activeLayer.id}
            disabled={playing}
            onSelect={(layerId) => session.selectLayer(layerId)}
            onAdd={() => session.addLayer()}
            onRename={(layerId, name) => session.renameLayer(layerId, name)}
            onRemove={(layerId) => session.removeLayer(layerId)}
            onMove={(layerId, direction) => session.moveLayer(layerId, direction)}
            onToggleVisible={(layerId, visible) => session.setLayerVisible(layerId, visible)}
          />
        </aside>
      </div>

      <Timeline session={session} snapshot={snapshot} />
    </div>
  );
}
