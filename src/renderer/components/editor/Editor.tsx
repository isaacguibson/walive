import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { EditorSession } from '@editor/editorSession';
import type { AIAPI, AssetsAPI, LayoutAPI, ScenesAPI } from '@shared/types/api';
import { matchShortcut } from '@editor/shortcuts/shortcuts';
import type { AgentController } from '../../ai/agentController';
import { useEditorSnapshot } from '../../state/useEditorSnapshot';
import { MAX_PANEL_WIDTH, MIN_PANEL_WIDTH, useToolWindows } from '../../state/useToolWindows';
import { AgentWorkspace } from '../ai/AgentWorkspace';
import { AssetPanel } from './AssetPanel';
import { CanvasWorkspace } from './CanvasWorkspace';
import { LayerPanel } from './LayerPanel';
import { PlaybackBar } from './PlaybackBar';
import { Timeline } from './Timeline';
import { ToolOptions } from './ToolOptions';
import { ToolPanel } from './ToolPanel';
import { IconButton } from './IconButton';

const MIN_TIMELINE_HEIGHT = 120;
const MAX_TIMELINE_HEIGHT = 340;

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

interface EditorProps {
  session: EditorSession;
  assetsApi: AssetsAPI;
  scenesApi: ScenesAPI;
  aiApi: AIAPI;
  layoutApi?: LayoutAPI;
  agent: AgentController;
  /** The scene being edited. */
  scene: { id: string; name: string };
  projectName: string;
  /** Scene controls shown in the header, before the project actions. */
  sceneSelector: ReactNode;
  saving: boolean;
  closing: boolean;
  onExport(): void;
  onSave(): void;
  onClose(): void;
}

const TEXT_INPUT_TYPES = new Set(['', 'text', 'number', 'search', 'email', 'url', 'tel', 'password']);

/** Controls that use Space and Enter themselves. */
const INTERACTIVE_SELECTOR =
  'button, input, select, textarea, summary, a[href], [role="button"], [role="switch"], [role="checkbox"], [role="radio"], [role="tab"], [role="option"], [role="slider"], [role="combobox"]';

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_SELECTOR) !== null;
}

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
export function Editor({ session, assetsApi, scenesApi, aiApi, layoutApi, agent, scene, projectName, sceneSelector, saving, closing, onExport, onSave, onClose }: EditorProps) {
  const snapshot = useEditorSnapshot(session);
  const { state } = snapshot;
  const rootRef = useRef<HTMLDivElement>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [timelineHeight, setTimelineHeight] = useState(168);
  const toolWindows = useToolWindows(layoutApi);
  const { minimized } = toolWindows.layout;
  const inspectorWidth = toolWindows.layout.widths.inspector;
  const aiChatWidth = toolWindows.layout.widths.chat;
  const [resizeState, setResizeState] = useState<
    null | { kind: 'timeline' | 'inspector' | 'chat'; startX: number; startY: number; startValue: number }
  >(null);
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
      if (event.key === ' ' && isInteractiveTarget(event.target)) {
        return;
      }
      if (event.target instanceof Element && event.target.closest('[role="dialog"], [role="menu"]') !== null) {
        return;
      }
      const action = matchShortcut(event);
      if (action === null) {
        return;
      }
      // These keys belong to the Bézier, Shape and Selection tools and must not steal Enter, Escape or Delete from other tools or controls.
      if (action.startsWith('tool.') && (!['bezier', 'shape', 'select'].includes(session.getSnapshot().state.selectedTool) || isInteractiveTarget(event.target))) {
        return;
      }
      if (action === 'playback.toggle' && event.repeat) {
        event.preventDefault();
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

  useEffect(() => {
    if (resizeState === null) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (resizeState.kind === 'timeline') {
        setTimelineHeight(clamp(resizeState.startValue + (resizeState.startY - event.clientY), MIN_TIMELINE_HEIGHT, MAX_TIMELINE_HEIGHT));
        return;
      }
      // Inspector and chat are both anchored to the right edge, and their separators sit on their
      // left side, so dragging left always grows the panel and dragging right shrinks it.
      const grow = resizeState.startX - event.clientX;
      if (resizeState.kind === 'inspector') {
        toolWindows.setWidth('inspector', clamp(resizeState.startValue + grow, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH));
        return;
      }
      toolWindows.setWidth('chat', clamp(resizeState.startValue + grow, MIN_PANEL_WIDTH, MAX_PANEL_WIDTH));
    };

    const handlePointerUp = () => setResizeState(null);

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resizeState]);

  function startResize(kind: 'timeline' | 'inspector' | 'chat', event: ReactPointerEvent<HTMLDivElement>) {
    event.preventDefault();
    setResizeState({
      kind,
      startX: event.clientX,
      startY: event.clientY,
      startValue: kind === 'timeline' ? timelineHeight : kind === 'inspector' ? inspectorWidth : aiChatWidth
    });
  }

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
            {sceneSelector}
            <IconButton
              icon="export"
              label="Export"
              tooltip="Export frames or animation"
              variant="default"
              text="Export"
              disabled={saving || closing}
              onClick={onExport}
            />
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
          <CanvasWorkspace session={session} snapshot={snapshot} assetsApi={assetsApi} />
        </main>

        {!minimized.toolOptions && (
          <div
            className="editor-resizer editor-resizer-vertical"
            role="separator"
            aria-label="Resize inspector panel"
            title="Resize inspector panel"
            onPointerDown={(event) => startResize('inspector', event)}
          />
        )}

        <aside className="editor-right">
          <div className="editor-side-panel" hidden={minimized.toolOptions} style={{ width: inspectorWidth }}>
            <ToolOptions
              onMinimize={() => toolWindows.setMinimized('toolOptions', true)}
              state={state}
              selectedCurve={snapshot.activeLayer.curves.find((curve) => curve.id === state.curveEditor.selectedCurveId) ?? null}
              curve={{
                onBrushTypeChange: (id) => session.setCurveBrushType(id),
                onBrushSettingChange: (key, value) => session.setCurveBrushSetting(key, value),
                onSizeChange: (size) => session.setCurveSize(size),
                onOpacityChange: (percent) => session.setCurveOpacity(percent),
                onApplyStyle: () => session.applyCurveStyle(),
                onAnchorTypeChange: (type) => session.setSelectedAnchorType(type),
                onRemoveAnchor: () => session.removeSelectedAnchor(),
                onDeleteCurve: () => session.deleteSelectedCurve()
              }}
              shape={{
                onKindChange: (kind) => session.setShapeKind(kind),
                onSizeChange: (size) => session.setShapeSize(size),
                onRotationChange: (degrees) => session.setShapeRotation(degrees),
                onStrokeWidthChange: (width) => session.setShapeStrokeWidth(width),
                onFillChange: (fill) => session.setShapeFill(fill),
                onOpacityChange: (percent) => session.setShapeOpacity(percent),
                onConfirm: () => session.finishShape(),
                onCancel: () => session.cancelShape()
              }}
              onColorChange={(color) => session.setColor(color)}
              onBrushSizeChange={(size) => session.setBrushSize(size)}
              onBrushTypeChange={(id) => session.setBrushType(id)}
              onBrushSettingChange={(key, value) => session.setBrushSetting(key, value)}
              onBrushOpacityChange={(percent) => session.setBrushOpacity(percent)}
              onUsePenPressureChange={(enabled) => session.setUsePenPressure(enabled)}
              onUsePenPressureOpacityChange={(enabled) => session.setUsePenPressureOpacity(enabled)}
              onStabilizeStrokeChange={(enabled) => session.setStabilizeStroke(enabled)}
              onEraserSizeChange={(size) => session.setEraserSize(size)}
              onSelectionKeepAspectRatioChange={(enabled) => session.setSelectionKeepAspectRatio(enabled)}
              onSelectionResamplingChange={(resampling) => session.setSelectionResampling(resampling)}
            />
            <AssetPanel assetsApi={assetsApi} />
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
          </div>

          {!minimized.ai && (
            <div
              className="editor-resizer editor-resizer-inner"
              role="separator"
              aria-label="Resize AI chat panel"
              title="Resize AI chat panel"
              onPointerDown={(event) => startResize('chat', event)}
            />
          )}

          <AgentWorkspace
            controller={agent}
            aiApi={aiApi}
            session={session}
            projectName={projectName}
            scene={scene}
            scenesApi={scenesApi}
            assetsApi={assetsApi}
            width={aiChatWidth}
            hidden={minimized.ai}
            onMinimize={() => toolWindows.setMinimized('ai', true)}
          />
        </aside>

        <nav className="tool-window-bar" aria-label="Tool windows">
          <IconButton
            icon="settings"
            label="Tool Options"
            tooltip={minimized.toolOptions ? 'Show Tool Options' : 'Minimize Tool Options'}
            pressed={!minimized.toolOptions}
            onClick={() => toolWindows.toggle('toolOptions')}
          />
          <IconButton
            icon="sparkles"
            label="AI Assistant"
            tooltip={minimized.ai ? 'Show AI Assistant' : 'Minimize AI Assistant'}
            pressed={!minimized.ai}
            onClick={() => toolWindows.toggle('ai')}
          />
        </nav>
      </div>

      <div className="editor-timeline-wrapper" style={{ height: timelineHeight }}>
        <div
          className="editor-resizer editor-resizer-horizontal"
          role="separator"
          aria-label="Resize timeline panel"
          title="Resize timeline panel"
          onPointerDown={(event) => startResize('timeline', event)}
        />
        <Timeline session={session} snapshot={snapshot} height={timelineHeight} />
      </div>
    </div>
  );
}
