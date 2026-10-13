import { useId, type ReactNode } from 'react';
import { MAX_EXPORT_DIMENSION, MAX_EXPORT_FPS, type AnimationFormatId, type ExportKind, type QualityPreset } from '@shared/types/export';
import {
  EXPORT_KIND_LABELS,
  FORMAT_LABELS,
  FPS_PRESETS,
  QUALITY_LABELS,
  usesTransparency,
  type ExportContext,
  type ExportSettings
} from '../../state/exportSettings';

interface ExportSettingsFormProps {
  settings: ExportSettings;
  context: ExportContext;
  /** `null` while the available encoders are still being checked. */
  formats: readonly AnimationFormatId[] | null;
  disabled: boolean;
  onChange(patch: Partial<ExportSettings>): void;
  onDimensionChange(side: 'width' | 'height', value: string): void;
}

interface FieldProps {
  id: string;
  label: string;
  hint?: string;
  children: ReactNode;
}

function Field({ id, label, hint, children }: FieldProps) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children}
      {hint !== undefined && <p className="field-hint">{hint}</p>}
    </div>
  );
}

const KINDS = Object.keys(EXPORT_KIND_LABELS) as ExportKind[];
const QUALITIES = Object.keys(QUALITY_LABELS) as QualityPreset[];

/** Settings of an export; only the ones that matter for the chosen export type are shown. */
export function ExportSettingsForm({ settings, context, formats, disabled, onChange, onDimensionChange }: ExportSettingsFormProps) {
  const prefix = useId();
  const id = (name: string) => `${prefix}-${name}`;
  const { kind } = settings;
  const isAnimation = kind === 'animation';
  const isGif = settings.format === 'gif';
  const activeScopeOnly = settings.scope === 'all';

  return (
    <fieldset className="export-form" disabled={disabled}>
      <Field id={id('kind')} label="Export type">
        <select id={id('kind')} value={kind} onChange={(event) => onChange({ kind: event.target.value as ExportKind })}>
          {KINDS.map((value) => (
            <option key={value} value={value}>
              {EXPORT_KIND_LABELS[value]}
            </option>
          ))}
        </select>
      </Field>

      {isAnimation && (
        <Field id={id('format')} label="Format">
          <select
            id={id('format')}
            value={settings.format}
            disabled={formats === null}
            onChange={(event) => onChange({ format: event.target.value as AnimationFormatId })}
          >
            {formats === null && <option>Checking available formats…</option>}
            {formats?.map((value) => (
              <option key={value} value={value}>
                {FORMAT_LABELS[value]}
              </option>
            ))}
          </select>
        </Field>
      )}

      {kind !== 'current-frame' && (
        <>
          <Field id={id('scope')} label="Scenes">
            <select id={id('scope')} value={settings.scope} onChange={(event) => onChange({ scope: event.target.value as ExportSettings['scope'] })}>
              <option value="active">Active scene ({context.sceneName})</option>
              <option value="all">All scenes</option>
            </select>
          </Field>

          <Field
            id={id('range')}
            label="Frames"
            {...(activeScopeOnly ? { hint: 'A custom range is only available for the active scene.' } : {})}
          >
            <select
              id={id('range')}
              value={settings.customRange && !activeScopeOnly ? 'custom' : 'all'}
              disabled={activeScopeOnly}
              onChange={(event) => onChange({ customRange: event.target.value === 'custom' })}
            >
              <option value="all">All frames</option>
              <option value="custom">Custom range</option>
            </select>
          </Field>
          {settings.customRange && !activeScopeOnly && (
            <div className="field-row">
              <Field id={id('start')} label="First frame">
                <input
                  id={id('start')}
                  type="number"
                  min={1}
                  max={context.frameCount}
                  value={settings.rangeStart}
                  onChange={(event) => onChange({ rangeStart: event.target.value })}
                />
              </Field>
              <Field id={id('end')} label="Last frame">
                <input
                  id={id('end')}
                  type="number"
                  min={1}
                  max={context.frameCount}
                  value={settings.rangeEnd}
                  onChange={(event) => onChange({ rangeEnd: event.target.value })}
                />
              </Field>
            </div>
          )}

          <Field id={id('resolution')} label="Resolution">
            <select
              id={id('resolution')}
              value={settings.customResolution ? 'custom' : 'original'}
              onChange={(event) => onChange({ customResolution: event.target.value === 'custom' })}
            >
              <option value="original">
                Original canvas size ({context.canvasWidth} × {context.canvasHeight})
              </option>
              <option value="custom">Custom resolution</option>
            </select>
          </Field>
          {settings.customResolution && (
            <>
              <div className="field-row">
                <Field id={id('width')} label="Width (px)">
                  <input
                    id={id('width')}
                    type="number"
                    min={1}
                    max={MAX_EXPORT_DIMENSION}
                    value={settings.width}
                    onChange={(event) => onDimensionChange('width', event.target.value)}
                  />
                </Field>
                <Field id={id('height')} label="Height (px)">
                  <input
                    id={id('height')}
                    type="number"
                    min={1}
                    max={MAX_EXPORT_DIMENSION}
                    value={settings.height}
                    onChange={(event) => onDimensionChange('height', event.target.value)}
                  />
                </Field>
              </div>
              <label className="checkbox-row export-checkbox" htmlFor={id('aspect')}>
                <input
                  id={id('aspect')}
                  type="checkbox"
                  checked={settings.keepAspectRatio}
                  onChange={(event) => onChange({ keepAspectRatio: event.target.checked })}
                />
                <span>Keep Aspect Ratio</span>
              </label>
            </>
          )}
        </>
      )}

      {isAnimation && (
        <>
          <Field id={id('fps-mode')} label="Frame rate">
            <select id={id('fps-mode')} value={settings.customFps ? 'custom' : 'scene'} onChange={(event) => onChange({ customFps: event.target.value === 'custom' })}>
              <option value="scene">Use scene FPS ({context.sceneFps})</option>
              <option value="custom">Custom FPS</option>
            </select>
          </Field>
          {settings.customFps && (
            <Field id={id('fps')} label="FPS">
              <input
                id={id('fps')}
                type="number"
                min={1}
                max={MAX_EXPORT_FPS}
                list={id('fps-presets')}
                value={settings.fps}
                onChange={(event) => onChange({ fps: event.target.value })}
              />
              <datalist id={id('fps-presets')}>
                {FPS_PRESETS.map((fps) => (
                  <option key={fps} value={fps} />
                ))}
              </datalist>
            </Field>
          )}

          {isGif ? (
            <Field
              id={id('background')}
              label="Background"
              hint="GIF transparency is limited: every pixel is either fully transparent or fully opaque, so soft edges and partial opacity are lost."
            >
              <select
                id={id('background')}
                value={usesTransparency(settings) ? 'transparent' : 'color'}
                onChange={(event) => onChange({ transparentBackground: event.target.value === 'transparent' })}
              >
                <option value="transparent">Transparent</option>
                <option value="color">Solid color</option>
              </select>
            </Field>
          ) : (
            <p className="field-hint">MP4 does not support transparency. Transparent areas are filled with the background color.</p>
          )}
          {!usesTransparency(settings) && (
            <Field id={id('color')} label="Background color">
              <input id={id('color')} type="color" value={settings.color} onChange={(event) => onChange({ color: event.target.value })} />
            </Field>
          )}

          <Field
            id={id('quality')}
            label="Quality"
            {...(isGif ? { hint: 'GIF uses a limited color palette, so some colors cannot be reproduced exactly. Higher quality uses more colors.' } : {})}
          >
            <select id={id('quality')} value={settings.quality} onChange={(event) => onChange({ quality: event.target.value as QualityPreset })}>
              {QUALITIES.map((value) => (
                <option key={value} value={value}>
                  {QUALITY_LABELS[value]}
                </option>
              ))}
            </select>
          </Field>

          {isGif && (
            <label className="checkbox-row export-checkbox" htmlFor={id('loop')}>
              <input id={id('loop')} type="checkbox" checked={settings.loop} onChange={(event) => onChange({ loop: event.target.checked })} />
              <span>Loop Animation</span>
            </label>
          )}
        </>
      )}
    </fieldset>
  );
}
