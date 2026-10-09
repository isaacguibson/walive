import { useEffect, useState } from 'react';
import { MAX_TOOL_SIZE, MIN_TOOL_SIZE } from '@editor/constants';
import type { EditorState } from '@editor/model';
import { TOOL_DEFINITIONS } from '@editor/tools';
import { parseToolSize } from '@editor/validation';

interface ToolOptionsProps {
  state: EditorState;
  onColorChange(color: string): void;
  onBrushSizeChange(size: string): boolean;
  onUsePenPressureChange(enabled: boolean): void;
  onStabilizeStrokeChange(enabled: boolean): void;
  onEraserSizeChange(size: string): boolean;
}

interface SizeFieldProps {
  id: string;
  label: string;
  value: number;
  disabled?: boolean;
  onCommit(value: string): boolean;
}

/** Number input that only commits valid sizes and restores the last valid one on blur. */
function SizeField({ id, label, value, onCommit, disabled = false }: SizeFieldProps) {
  const [draft, setDraft] = useState(String(value));
  const invalid = parseToolSize(draft) === null;

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-row field-inline">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          value={draft}
          disabled={disabled}
          aria-invalid={invalid}
          aria-describedby={invalid ? `${id}-error` : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            onCommit(event.target.value);
          }}
          onBlur={() => setDraft(String(value))}
        />
        <span className="unit">px</span>
      </div>
      {invalid && (
        <p id={`${id}-error`} className="form-error" role="alert">
          Enter a whole number from {MIN_TOOL_SIZE} to {MAX_TOOL_SIZE}.
        </p>
      )}
    </div>
  );
}

/** Upper right section: properties of the selected tool. */
export function ToolOptions({
  state,
  onColorChange,
  onBrushSizeChange,
  onUsePenPressureChange,
  onStabilizeStrokeChange,
  onEraserSizeChange
}: ToolOptionsProps) {
  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.id === state.selectedTool);
  const usesColor = state.selectedTool === 'brush' || state.selectedTool === 'fill';

  return (
    <section className="tool-options" aria-label="Tool Options">
      <h2 className="panel-title">Tool Options</h2>
      <p className="tool-options-name">{tool?.name}</p>

      {state.selectedTool === 'brush' && (
        <>
          <SizeField id="brush-size" label="Size" value={state.brushSize} onCommit={onBrushSizeChange} disabled={state.usePenPressure} />
          <div className="pressure-toggle-row">
            <button
              type="button"
              role="switch"
              aria-label="Use Pen Pressure"
              aria-checked={state.usePenPressure}
              title="Use pen pressure to control brush size"
              className={state.usePenPressure ? 'pressure-toggle is-enabled' : 'pressure-toggle'}
              onClick={() => onUsePenPressureChange(!state.usePenPressure)}
            >
              <span className="pressure-toggle-knob" />
            </button>
            <span>Use Pen Pressure</span>
          </div>
          <p className="pressure-help muted">Requires a pressure-sensitive pen. Mouse input uses the configured size.</p>
          <div className="pressure-toggle-row">
            <button
              type="button"
              role="switch"
              aria-label="Stabilize Stroke"
              aria-checked={state.stabilizeStroke}
              title="Smooth brush strokes to reduce unintended tremors"
              className={state.stabilizeStroke ? 'pressure-toggle is-enabled' : 'pressure-toggle'}
              onClick={() => onStabilizeStrokeChange(!state.stabilizeStroke)}
            >
              <span className="pressure-toggle-knob" />
            </button>
            <span>Stabilize Stroke</span>
          </div>
          <p className="pressure-help muted">Smooths brush movement to reduce unintended tremors.</p>
        </>
      )}
      {state.selectedTool === 'eraser' && (
        <SizeField id="eraser-size" label="Size" value={state.eraserSize} onCommit={onEraserSizeChange} />
      )}

      {usesColor && (
        <div className="field">
          <label htmlFor="tool-color">Color</label>
          <input
            id="tool-color"
            className="color-input"
            type="color"
            value={state.color}
            onChange={(event) => onColorChange(event.target.value)}
          />
        </div>
      )}

      {state.selectedTool === 'eyedropper' && (
        <>
          <p className="muted">Click the canvas to use that color.</p>
          <div className="field">
            <span className="field-caption">Current color</span>
            <span className="color-swatch" style={{ background: state.color }} aria-label={`Current color ${state.color}`} role="img" />
          </div>
        </>
      )}

      {state.selectedTool === 'selection' && (
        <p className="muted" data-testid="selection-info">
          {state.selection === null
            ? 'Drag on the canvas to select an area.'
            : `Selection: ${state.selection.width} × ${state.selection.height} px at ${state.selection.x}, ${state.selection.y}`}
        </p>
      )}

      {state.selectedTool === 'eraser' && <p className="muted">Erases only the active layer.</p>}
    </section>
  );
}
