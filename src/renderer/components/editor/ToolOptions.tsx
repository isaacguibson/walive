import { useEffect, useState } from 'react';
import { BRUSHES, findBrush } from '@editor/brushes/registry';
import { MAX_TOOL_SIZE, MIN_TOOL_SIZE } from '@editor/constants';
import type { EditorState } from '@editor/model';
import { TOOL_DEFINITIONS } from '@editor/tools';
import { parseToolSize } from '@editor/validation';
import { IconButton } from './IconButton';

interface ToolOptionsProps {
  state: EditorState;
  onColorChange(color: string): void;
  onBrushTypeChange(id: string): void;
  onBrushSettingChange(key: string, value: number): void;
  onBrushSizeChange(size: string): boolean;
  onBrushOpacityChange(percent: number): void;
  onUsePenPressureChange(enabled: boolean): void;
  onUsePenPressureOpacityChange(enabled: boolean): void;
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

interface RangeFieldProps {
  id: string;
  label: string;
  value: number;
  min: number;
  max: number;
  unit: string;
  onChange(value: number): void;
}

/** Slider with its current value; the range is enforced by the input itself. */
function RangeField({ id, label, value, min, max, unit, onChange }: RangeFieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-row field-inline">
        <input id={id} type="range" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} />
        <span className="unit range-value">
          {value}
          {unit}
        </span>
      </div>
    </div>
  );
}

/** Upper right section: properties of the selected tool. */
export function ToolOptions({
  state,
  onColorChange,
  onBrushTypeChange,
  onBrushSettingChange,
  onBrushSizeChange,
  onBrushOpacityChange,
  onUsePenPressureChange,
  onUsePenPressureOpacityChange,
  onStabilizeStrokeChange,
  onEraserSizeChange
}: ToolOptionsProps) {
  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.id === state.selectedTool);
  const brush = findBrush(state.brushType);
  const colorField = (
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
  );

  return (
    <section className="tool-options" aria-label="Tool Options">
      <h2 className="panel-title">Tool Options</h2>
      <p className="tool-options-name">{tool?.name}</p>

      {state.selectedTool === 'brush' && (
        <>
          <div className="field">
            <label htmlFor="brush-type">Brush Type</label>
            <select id="brush-type" value={state.brushType} onChange={(event) => onBrushTypeChange(event.target.value)}>
              {BRUSHES.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.name}
                </option>
              ))}
            </select>
          </div>
          <SizeField id="brush-size" label="Size" value={state.brushSize} onCommit={onBrushSizeChange} disabled={state.usePenPressure} />
          <RangeField id="brush-opacity" label="Opacity" value={state.brushOpacity} min={0} max={100} unit="%" onChange={onBrushOpacityChange} />
          <div className="brush-toggles">
            <IconButton
              icon="pressure"
              label="Use Pen Pressure"
              tooltip="Use pen pressure to control brush size"
              variant="toggle"
              pressed={state.usePenPressure}
              onClick={() => onUsePenPressureChange(!state.usePenPressure)}
            />
            <IconButton
              icon="opacity"
              label="Use Pen Pressure for Opacity"
              tooltip="Use pen pressure to control stroke opacity"
              variant="toggle"
              pressed={state.usePenPressureOpacity}
              onClick={() => onUsePenPressureOpacityChange(!state.usePenPressureOpacity)}
            />
            <IconButton
              icon="stabilize"
              label="Stabilize Stroke"
              tooltip="Smooth brush strokes to reduce unintended tremors"
              variant="toggle"
              pressed={state.stabilizeStroke}
              onClick={() => onStabilizeStrokeChange(!state.stabilizeStroke)}
            />
          </div>
          <p className="brush-toggles-help muted">
            Pressure options require a pressure-sensitive pen. Mouse input uses the configured size and full opacity.
          </p>
          {colorField}
          {brush.options.length > 0 && (
            <div role="group" aria-label={`${brush.name} Settings`}>
              {brush.options.map((option) => (
                <RangeField
                  key={option.key}
                  id={`brush-option-${option.key}`}
                  label={option.label}
                  value={state.brushSettings[option.key] ?? option.min}
                  min={option.min}
                  max={option.max}
                  unit={option.unit}
                  onChange={(value) => onBrushSettingChange(option.key, value)}
                />
              ))}
            </div>
          )}
        </>
      )}
      {state.selectedTool === 'eraser' && (
        <SizeField id="eraser-size" label="Size" value={state.eraserSize} onCommit={onEraserSizeChange} />
      )}

      {state.selectedTool === 'fill' && colorField}

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
