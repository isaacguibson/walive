import { useEffect, useId, useState } from 'react';
import { MAX_FPS, MAX_ZOOM } from '@editor/constants';
import type { EditorState } from '@editor/model';
import { parseZoom } from '@editor/validation';
import { IconButton } from './IconButton';

interface PlaybackBarProps {
  state: EditorState;
  isFullscreen: boolean;
  canPlay: boolean;
  onTogglePlayback(): void;
  onLoopChange(loop: boolean): void;
  onFpsChange(fps: string): boolean;
  onZoomChange(zoom: string): boolean;
  onToggleFullscreen(): void;
}

/** Controls displayed above the canvas: playback, loop, FPS, zoom and fullscreen. */
export function PlaybackBar({
  state,
  isFullscreen,
  canPlay,
  onTogglePlayback,
  onLoopChange,
  onFpsChange,
  onZoomChange,
  onToggleFullscreen
}: PlaybackBarProps) {
  const fpsId = useId();
  const zoomId = useId();
  const [zoomDraft, setZoomDraft] = useState(String(state.zoom));
  const zoomInvalid = parseZoom(zoomDraft) === null;

  useEffect(() => {
    setZoomDraft(String(state.zoom));
  }, [state.zoom]);

  const playLabel = state.isPlaying ? 'Stop Animation' : 'Play Animation';

  return (
    <div className="playback-bar" role="toolbar" aria-label="Playback controls">
      <IconButton
        icon={state.isPlaying ? 'stop' : 'play'}
        label={playLabel}
        variant="round"
        size={20}
        disabled={!state.isPlaying && !canPlay}
        onClick={onTogglePlayback}
      />
      <IconButton
        icon="loop"
        label="Loop Playback"
        variant="toggle"
        text="Loop"
        pressed={state.loopPlayback}
        onClick={() => onLoopChange(!state.loopPlayback)}
      />

      <div className="bar-field">
        <label htmlFor={fpsId}>FPS</label>
        <input
          id={fpsId}
          className="bar-input bar-input-range"
          type="range"
          min={1}
          max={MAX_FPS}
          step={1}
          value={state.fps}
          title="Frames per second"
          onChange={(event) => onFpsChange(event.target.value)}
        />
        <span className="unit range-value">{state.fps}</span>
      </div>

      <div className="bar-spacer" />

      <div className="bar-field">
        <label htmlFor={zoomId}>Zoom</label>
        <input
          id={zoomId}
          className="bar-input"
          type="text"
          inputMode="decimal"
          value={zoomDraft}
          title={`Zoom percentage (greater than 0, up to ${MAX_ZOOM})`}
          aria-invalid={zoomInvalid}
          onChange={(event) => {
            setZoomDraft(event.target.value);
            onZoomChange(event.target.value);
          }}
          onBlur={() => setZoomDraft(String(state.zoom))}
        />
        <span className="unit">%</span>
        {zoomInvalid && (
          <span className="form-error bar-error" role="alert">
            Zoom must be greater than 0.
          </span>
        )}
      </div>

      <IconButton
        icon={isFullscreen ? 'exitFullscreen' : 'fullscreen'}
        label={isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        onClick={onToggleFullscreen}
      />
    </div>
  );
}
