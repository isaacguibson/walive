import { useEffect, useState, type ReactNode } from 'react';
import { BRUSHES, findBrush } from '@editor/brushes/registry';
import { MAX_TOOL_SIZE, MIN_TOOL_SIZE } from '@editor/constants';
import { canRemoveAnchor } from '@editor/curves/editing';
import type { AnchorType, BezierCurve } from '@editor/curves/curve';
import type { BrushConfigState, EditorState, SelectionResampling } from '@editor/model';
import { TOOL_DEFINITIONS } from '@editor/tools';
import {
  MAX_SHAPE_SIZE,
  MAX_SHAPE_STROKE,
  MIN_SHAPE_SIZE,
  MIN_SHAPE_STROKE,
  SHAPE_KINDS,
  type ShapeKind,
  type ShapeOptions
} from '@editor/shapes/geometry';
import { parseToolSize } from '@editor/validation';
import { IconButton } from './IconButton';

/** Options of the Bézier tool and actions on the selected curve. */
export interface CurveOptionsHandlers {
  onBrushTypeChange(id: string): void;
  onBrushSettingChange(key: string, value: number): void;
  onSizeChange(size: string): boolean;
  onOpacityChange(percent: number): void;
  onApplyStyle(): void;
  onAnchorTypeChange(type: AnchorType): void;
  onRemoveAnchor(): void;
  onDeleteCurve(): void;
}

/** Options of the Geometric Shapes tool and the actions on the pending shape. */
export interface ShapeOptionsHandlers {
  onKindChange(kind: ShapeKind): void;
  onSizeChange(size: number): void;
  onRotationChange(degrees: number): void;
  onStrokeWidthChange(width: number): void;
  onFillChange(fill: boolean): void;
  onOpacityChange(percent: number): void;
  onConfirm(): void;
  onCancel(): void;
}

interface ToolOptionsProps {
  state: EditorState;
  /** The curve selected with the Bézier tool, if it is on the active layer. */
  selectedCurve: BezierCurve | null;
  curve: CurveOptionsHandlers;
  shape: ShapeOptionsHandlers;
  onColorChange(color: string): void;
  onBrushTypeChange(id: string): void;
  onBrushSettingChange(key: string, value: number): void;
  onBrushSizeChange(size: string): boolean;
  onBrushOpacityChange(percent: number): void;
  onUsePenPressureChange(enabled: boolean): void;
  onUsePenPressureOpacityChange(enabled: boolean): void;
  onStabilizeStrokeChange(enabled: boolean): void;
  onEraserSizeChange(size: string): boolean;
  onSelectionKeepAspectRatioChange(enabled: boolean): void;
  onSelectionResamplingChange(resampling: SelectionResampling): void;
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

interface SizeRangeFieldProps {
  id: string;
  label: string;
  value: number;
  disabled?: boolean;
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

/** Size slider with fixed limits shared by tool settings. */
function SizeRangeField({ id, label, value, onChange, disabled = false }: SizeRangeFieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="field-row field-inline">
        <input
          id={id}
          type="range"
          min={MIN_TOOL_SIZE}
          max={MAX_TOOL_SIZE}
          step={1}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(Number(event.target.value))}
        />
        <span className="unit range-value">
          {value}
          px
        </span>
      </div>
    </div>
  );
}

/** Brush type, size, opacity and the settings of the chosen type: shared by the tools that use the brush engine. */
function BrushFields({
  prefix,
  config,
  sizeDisabled = false,
  middle,
  onTypeChange,
  onSizeChange,
  onOpacityChange,
  onSettingChange,
  children,
  sizeControl = 'text'
}: {
  prefix: string;
  config: BrushConfigState;
  sizeDisabled?: boolean;
  /** Rendered between the opacity and the settings of the brush type. */
  middle?: ReactNode;
  onTypeChange(id: string): void;
  onSizeChange(size: string): boolean;
  onOpacityChange(percent: number): void;
  onSettingChange(key: string, value: number): void;
  children?: ReactNode;
  sizeControl?: 'text' | 'slider';
}) {
  const brush = findBrush(config.type);
  return (
    <>
      <div className="field">
        <label htmlFor={`${prefix}-type`}>Brush Type</label>
        <select id={`${prefix}-type`} value={config.type} onChange={(event) => onTypeChange(event.target.value)}>
          {BRUSHES.map((option) => (
            <option key={option.id} value={option.id}>
              {option.name}
            </option>
          ))}
        </select>
      </div>
      {sizeControl === 'slider' ? (
        <SizeRangeField
          id={`${prefix}-size`}
          label="Size"
          value={config.size}
          disabled={sizeDisabled}
          onChange={(value) => onSizeChange(String(value))}
        />
      ) : (
        <SizeField id={`${prefix}-size`} label="Size" value={config.size} onCommit={onSizeChange} disabled={sizeDisabled} />
      )}
      <RangeField id={`${prefix}-opacity`} label="Opacity" value={config.opacity} min={0} max={100} unit="%" onChange={onOpacityChange} />
      {children}
      {middle}
      {brush.options.length > 0 && (
        <div role="group" aria-label={`${brush.name} Settings`}>
          {brush.options.map((option) => (
            <RangeField
              key={option.key}
              id={`${prefix}-option-${option.key}`}
              label={option.label}
              value={config.settings[option.key] ?? option.min}
              min={option.min}
              max={option.max}
              unit={option.unit}
              onChange={(value) => onSettingChange(option.key, value)}
            />
          ))}
        </div>
      )}
    </>
  );
}

/** Angle in degrees: a slider for quick changes and a text field for an exact value. */
function RotationField({ value, onChange }: { value: number; onChange(degrees: number): void }) {
  // A dragged line can have any angle; it is shown to a tenth of a degree.
  const shown = String(Math.round(value * 10) / 10);
  const [draft, setDraft] = useState(shown);

  useEffect(() => {
    setDraft(shown);
  }, [shown]);

  return (
    <div className="field">
      <label htmlFor="shape-rotation">Rotation</label>
      <div className="field-row field-inline">
        <input id="shape-rotation" type="range" min={-180} max={180} step={1} value={Math.round(value)} onChange={(event) => onChange(Number(event.target.value))} />
        <input
          type="text"
          inputMode="numeric"
          aria-label="Rotation in degrees"
          className="degrees-input"
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            if (event.target.value.trim() !== '' && Number.isFinite(Number(event.target.value))) {
              onChange(Number(event.target.value));
            }
          }}
          onBlur={() => setDraft(shown)}
        />
        <span className="unit">°</span>
      </div>
    </div>
  );
}

interface ShapeFieldsProps {
  shape: ShapeOptions;
  pending: boolean;
  handlers: ShapeOptionsHandlers;
  colorField: ReactNode;
}

/** Shape, size, rotation and look of the Geometric Shapes tool; a pending shape follows every change. */
function ShapeFields({ shape, pending, handlers, colorField }: ShapeFieldsProps) {
  const isLine = shape.kind === 'line';
  return (
    <>
      <p className="muted">
        Press on the canvas and drag to size the shape (a click places it with the size below). Drag it to move it. Enter or a click outside it paints it as ordinary artwork; Esc discards it.
      </p>
      <div className="field">
        <label htmlFor="shape-kind">Shape</label>
        <select id="shape-kind" value={shape.kind} onChange={(event) => handlers.onKindChange(event.target.value as ShapeKind)}>
          {SHAPE_KINDS.map((kind) => (
            <option key={kind.id} value={kind.id}>
              {kind.name}
            </option>
          ))}
        </select>
      </div>
      <RangeField id="shape-size" label={isLine ? 'Length' : 'Size'} value={Math.round(shape.size)} min={MIN_SHAPE_SIZE} max={MAX_SHAPE_SIZE} unit="px" onChange={handlers.onSizeChange} />
      <RotationField value={shape.rotation} onChange={handlers.onRotationChange} />
      {!isLine && (
        <div className="checkbox-field">
          <label className="checkbox-row" htmlFor="shape-fill">
            <input id="shape-fill" type="checkbox" checked={shape.fill} onChange={(event) => handlers.onFillChange(event.target.checked)} />
            <span>Fill</span>
          </label>
        </div>
      )}
      {(isLine || !shape.fill) && (
        <RangeField
          id="shape-stroke"
          label={isLine ? 'Line Width' : 'Outline Width'}
          value={shape.strokeWidth}
          min={MIN_SHAPE_STROKE}
          max={MAX_SHAPE_STROKE}
          unit="px"
          onChange={handlers.onStrokeWidthChange}
        />
      )}
      {colorField}
      <RangeField id="shape-opacity" label="Opacity" value={shape.opacity} min={0} max={100} unit="%" onChange={handlers.onOpacityChange} />
      {pending && (
        <div className="curve-actions" role="group" aria-label="Pending Shape">
          <button type="button" className="button button-small" onClick={handlers.onConfirm}>
            Confirm Shape
          </button>
          <button type="button" className="button button-small" onClick={handlers.onCancel}>
            Cancel Shape
          </button>
        </div>
      )}
    </>
  );
}

/** Upper right section: properties of the selected tool. */
export function ToolOptions({
  state,
  selectedCurve,
  curve,
  shape,
  onColorChange,
  onBrushTypeChange,
  onBrushSettingChange,
  onBrushSizeChange,
  onBrushOpacityChange,
  onUsePenPressureChange,
  onUsePenPressureOpacityChange,
  onStabilizeStrokeChange,
  onEraserSizeChange,
  onSelectionKeepAspectRatioChange,
  onSelectionResamplingChange
}: ToolOptionsProps) {
  const tool = TOOL_DEFINITIONS.find((candidate) => candidate.id === state.selectedTool);
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
        <BrushFields
          prefix="brush"
          config={{ size: state.brushSize, opacity: state.brushOpacity, type: state.brushType, settings: state.brushSettings }}
          sizeControl="slider"
          sizeDisabled={state.usePenPressure}
          middle={colorField}
          onTypeChange={onBrushTypeChange}
          onSizeChange={onBrushSizeChange}
          onOpacityChange={onBrushOpacityChange}
          onSettingChange={onBrushSettingChange}
        >
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
        </BrushFields>
      )}
      {state.selectedTool === 'bezier' && (
        <>
          <p className="muted">
            Click to add anchors, then drag an anchor or its handles to shape the curve. Enter or a double-click paints it as ordinary artwork; Esc discards it.
          </p>
          <BrushFields
            prefix="curve"
            config={state.curveBrush}
            sizeControl="slider"
            middle={colorField}
            onTypeChange={curve.onBrushTypeChange}
            onSizeChange={curve.onSizeChange}
            onOpacityChange={curve.onOpacityChange}
            onSettingChange={curve.onBrushSettingChange}
          >
            <div className="brush-toggles">
              <IconButton
                icon="pressure"
                label="Use Pen Pressure"
                tooltip="Pen pressure is not available for curves"
                variant="toggle"
                pressed={false}
                disabled
              />
              <IconButton
                icon="opacity"
                label="Use Pen Pressure for Opacity"
                tooltip="Pen pressure is not available for curves"
                variant="toggle"
                pressed={false}
                disabled
              />
            </div>
          </BrushFields>
          {selectedCurve !== null && (
            <div className="curve-actions" role="group" aria-label="Selected Curve">
              <button
                type="button"
                className="button button-small"
                title="Draw the selected curve with the options above"
                onClick={curve.onApplyStyle}
              >
                Apply Options to Curve
              </button>
              {state.curveEditor.selectedAnchor !== null && (
                <>
                  <div className="curve-actions-row">
                    {(['smooth', 'corner'] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        className="button button-small"
                        title={type === 'smooth' ? 'Keep the handles of the selected anchor aligned' : 'Move the handles of the selected anchor independently'}
                        aria-pressed={selectedCurve.anchors[state.curveEditor.selectedAnchor ?? 0]?.type === type}
                        onClick={() => curve.onAnchorTypeChange(type)}
                      >
                        {type === 'smooth' ? 'Smooth Anchor' : 'Corner Anchor'}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    className="button button-small"
                    title="Remove the selected anchor"
                    disabled={!canRemoveAnchor(selectedCurve)}
                    onClick={curve.onRemoveAnchor}
                  >
                    Remove Anchor
                  </button>
                </>
              )}
              <button type="button" className="button button-small" title="Delete the selected curve" onClick={curve.onDeleteCurve}>
                Delete Curve
              </button>
            </div>
          )}
        </>
      )}
      {state.selectedTool === 'eraser' && (
        <SizeRangeField
          id="eraser-size"
          label="Size"
          value={state.eraserSize}
          onChange={(size) => onEraserSizeChange(String(size))}
        />
      )}

      {state.selectedTool === 'fill' && colorField}

      {state.selectedTool === 'shape' && <ShapeFields shape={state.shape} pending={state.shapeEditor.pending !== null} handlers={shape} colorField={colorField} />}

      {state.selectedTool === 'select' && (
        <>
          <p className="muted">
            Drag to select an area of the active layer. Drag inside it to move, drag a handle to resize, drag the round handle above it to
            rotate. Click outside to apply, Esc to cancel.
          </p>
          <div className="checkbox-field">
            <label className="checkbox-row" htmlFor="selection-keep-aspect-ratio">
              <input
                id="selection-keep-aspect-ratio"
                type="checkbox"
                checked={state.selectionOptions.keepAspectRatio}
                onChange={(event) => onSelectionKeepAspectRatioChange(event.target.checked)}
              />
              <span>Keep Aspect Ratio</span>
            </label>
          </div>
          <div className="field">
            <label htmlFor="selection-resampling">Resampling</label>
            <select
              id="selection-resampling"
              value={state.selectionOptions.resampling}
              onChange={(event) => onSelectionResamplingChange(event.target.value as SelectionResampling)}
            >
              <option value="nearest">Nearest Neighbor</option>
              <option value="smooth">Smooth</option>
            </select>
          </div>
        </>
      )}

      {state.selectedTool === 'eraser' && <p className="muted">Erases only the active layer.</p>}
    </section>
  );
}
