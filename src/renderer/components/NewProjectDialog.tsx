import { useState, type FormEvent } from 'react';
import type { ProjectAPI } from '@shared/types/api';
import type { ProjectCanvas } from '@shared/types/project';
import { Dialog } from './Dialog';

interface NewProjectDialogProps {
  api: ProjectAPI;
  /** True while the project is being created; blocks repeated submissions. */
  busy: boolean;
  onCancel(): void;
  /** Resolves to an error message to display, or `null` when creation succeeded. */
  onCreate(name: string, location: string, canvas?: ProjectCanvas): Promise<string | null>;
}

function asPositiveInteger(value: string): number | null {
  if (value.trim() === '') {
    return null;
  }
  if (!/^\d+$/.test(value.trim())) {
    return null;
  }
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function gcd(a: number, b: number): number {
  let left = Math.abs(a);
  let right = Math.abs(b);
  while (right !== 0) {
    const remainder = left % right;
    left = right;
    right = remainder;
  }
  return left;
}

function reduceAspectRatio(width: number, height: number): { width: number; height: number } {
  const divisor = gcd(width, height);
  return { width: width / divisor, height: height / divisor };
}

function roundDimension(value: number): number {
  return Math.round(value);
}

export function NewProjectDialog({ api, busy, onCancel, onCreate }: NewProjectDialogProps) {
  const [name, setName] = useState('');
  const [location, setLocation] = useState('');
  const [width, setWidth] = useState('1920');
  const [height, setHeight] = useState('1080');
  const [keepAspectRatio, setKeepAspectRatio] = useState(false);
  const [aspectRatioWidth, setAspectRatioWidth] = useState('');
  const [aspectRatioHeight, setAspectRatioHeight] = useState('');
  const [error, setError] = useState<string | null>(null);

  function updateAspectRatioFromDimensions(reference: 'width' | 'height') {
    const ratioWidthValue = asPositiveInteger(aspectRatioWidth);
    const ratioHeightValue = asPositiveInteger(aspectRatioHeight);
    if (ratioWidthValue === null || ratioHeightValue === null) {
      return;
    }

    const widthValue = asPositiveInteger(width);
    const heightValue = asPositiveInteger(height);
    if (reference === 'width' && widthValue !== null) {
      const nextHeight = roundDimension((widthValue * ratioHeightValue) / ratioWidthValue);
      if (nextHeight > 0) {
        setHeight(String(nextHeight));
      }
      return;
    }
    if (reference === 'height' && heightValue !== null) {
      const nextWidth = roundDimension((heightValue * ratioWidthValue) / ratioHeightValue);
      if (nextWidth > 0) {
        setWidth(String(nextWidth));
      }
    }
  }

  function initializeAspectRatio() {
    const widthValue = asPositiveInteger(width);
    const heightValue = asPositiveInteger(height);
    if (widthValue !== null && heightValue !== null) {
      const ratio = reduceAspectRatio(widthValue, heightValue);
      setAspectRatioWidth(String(ratio.width));
      setAspectRatioHeight(String(ratio.height));
      return;
    }
    if (widthValue === null && heightValue !== null) {
      const existingRatioWidth = asPositiveInteger(aspectRatioWidth);
      const existingRatioHeight = asPositiveInteger(aspectRatioHeight);
      if (existingRatioWidth !== null && existingRatioHeight !== null) {
        setAspectRatioWidth(String(existingRatioWidth));
        setAspectRatioHeight(String(existingRatioHeight));
      }
    }
  }

  async function browse() {
    const result = await api.selectDirectory();
    if (!result.ok) {
      setError(result.error.message);
    } else if (result.value !== null) {
      setLocation(result.value);
      setError(null);
    }
  }

  function buildCanvas(): ProjectCanvas | null {
    const widthValue = asPositiveInteger(width);
    const heightValue = asPositiveInteger(height);
    if (widthValue === null) {
      setError('Width must be a positive integer.');
      return null;
    }
    if (heightValue === null) {
      setError('Height must be a positive integer.');
      return null;
    }
    if (keepAspectRatio) {
      const ratioWidthValue = asPositiveInteger(aspectRatioWidth);
      const ratioHeightValue = asPositiveInteger(aspectRatioHeight);
      if (ratioWidthValue === null) {
        setError('Aspect ratio width must be a positive integer.');
        return null;
      }
      if (ratioHeightValue === null) {
        setError('Aspect ratio height must be a positive integer.');
        return null;
      }
      return {
        width: widthValue,
        height: heightValue,
        keepAspectRatio: true,
        aspectRatio: { width: ratioWidthValue, height: ratioHeightValue }
      };
    }
    return {
      width: widthValue,
      height: heightValue,
      keepAspectRatio: false
    };
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy) {
      return;
    }
    if (name.trim().length === 0) {
      setError('Enter a project name.');
      return;
    }
    if (location.trim().length === 0) {
      setError('Select a location for the project.');
      return;
    }
    const canvas = buildCanvas();
    if (canvas === null) {
      return;
    }
    setError(null);
    const failure = await onCreate(name, location, canvas);
    if (failure !== null) {
      setError(failure);
    }
  }

  return (
    <Dialog title="Create New Project" titleId="new-project-title" onCancel={busy ? () => undefined : onCancel}>
      <form onSubmit={(event) => void submit(event)} noValidate>
        <div className="field">
          <label htmlFor="project-name">Project Name</label>
          <input
            id="project-name"
            type="text"
            value={name}
            maxLength={100}
            disabled={busy}
            autoComplete="off"
            placeholder="My Animation"
            onChange={(event) => setName(event.target.value)}
          />
        </div>

        <div className="field">
          <label htmlFor="project-location">Location</label>
          <div className="field-row">
            <input
              id="project-location"
              type="text"
              value={location}
              disabled={busy}
              autoComplete="off"
              placeholder="Choose a folder"
              onChange={(event) => setLocation(event.target.value)}
            />
            <button type="button" className="button" disabled={busy} onClick={() => void browse()}>
              Browse...
            </button>
          </div>
        </div>

        <div className="field canvas-field">
          <label>Canvas</label>
          <div className="canvas-size-row">
            <div className="canvas-number-field">
              <label htmlFor="project-width">Width</label>
              <div className="field-row field-inline">
                <input
                  id="project-width"
                  type="number"
                  min="1"
                  step="1"
                  value={width}
                  disabled={busy}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setWidth(nextValue);
                    if (!keepAspectRatio) {
                      return;
                    }
                    const ratioWidthValue = asPositiveInteger(aspectRatioWidth);
                    const ratioHeightValue = asPositiveInteger(aspectRatioHeight);
                    if (ratioWidthValue === null || ratioHeightValue === null) {
                      return;
                    }
                    const nextWidth = asPositiveInteger(nextValue);
                    if (nextWidth === null) {
                      return;
                    }
                    setHeight(String(roundDimension((nextWidth * ratioHeightValue) / ratioWidthValue)));
                  }}
                />
              </div>
            </div>
            <div className="canvas-number-field">
              <label htmlFor="project-height">Height</label>
              <div className="field-row field-inline">
                <input
                  id="project-height"
                  type="number"
                  min="1"
                  step="1"
                  value={height}
                  disabled={busy}
                  onChange={(event) => {
                    const nextValue = event.target.value;
                    setHeight(nextValue);
                    if (!keepAspectRatio) {
                      return;
                    }
                    const ratioWidthValue = asPositiveInteger(aspectRatioWidth);
                    const ratioHeightValue = asPositiveInteger(aspectRatioHeight);
                    if (ratioWidthValue === null || ratioHeightValue === null) {
                      return;
                    }
                    const nextHeight = asPositiveInteger(nextValue);
                    if (nextHeight === null) {
                      return;
                    }
                    setWidth(String(roundDimension((nextHeight * ratioWidthValue) / ratioHeightValue)));
                  }}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="checkbox-field">
          <label className="checkbox-row" htmlFor="keep-aspect-ratio">
            <input
              id="keep-aspect-ratio"
              type="checkbox"
              checked={keepAspectRatio}
              disabled={busy}
              onChange={(event) => {
                const enabled = event.target.checked;
                setKeepAspectRatio(enabled);
                if (!enabled) {
                  return;
                }
                initializeAspectRatio();
              }}
            />
            <span>Keep Aspect Ratio</span>
          </label>
        </div>

        {keepAspectRatio && (
          <div className="field">
            <label>Aspect Ratio</label>
            <div className="ratio-row">
              <input
                aria-label="Aspect Ratio Width"
                type="number"
                min="1"
                step="1"
                value={aspectRatioWidth}
                disabled={busy}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setAspectRatioWidth(nextValue);
                  if (!keepAspectRatio) {
                    return;
                  }
                  const ratioWidthValue = asPositiveInteger(nextValue);
                  const ratioHeightValue = asPositiveInteger(aspectRatioHeight);
                  if (ratioWidthValue === null || ratioHeightValue === null) {
                    return;
                  }
                  if (asPositiveInteger(width) !== null) {
                    setHeight(String(roundDimension((asPositiveInteger(width)! * ratioHeightValue) / ratioWidthValue)));
                  } else if (asPositiveInteger(height) !== null) {
                    setWidth(String(roundDimension((asPositiveInteger(height)! * ratioWidthValue) / ratioHeightValue)));
                  }
                }}
              />
              <span className="ratio-separator">:</span>
              <input
                aria-label="Aspect Ratio Height"
                type="number"
                min="1"
                step="1"
                value={aspectRatioHeight}
                disabled={busy}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  setAspectRatioHeight(nextValue);
                  if (!keepAspectRatio) {
                    return;
                  }
                  const ratioWidthValue = asPositiveInteger(aspectRatioWidth);
                  const ratioHeightValue = asPositiveInteger(nextValue);
                  if (ratioWidthValue === null || ratioHeightValue === null) {
                    return;
                  }
                  if (asPositiveInteger(width) !== null) {
                    setHeight(String(roundDimension((asPositiveInteger(width)! * ratioHeightValue) / ratioWidthValue)));
                  } else if (asPositiveInteger(height) !== null) {
                    setWidth(String(roundDimension((asPositiveInteger(height)! * ratioWidthValue) / ratioHeightValue)));
                  }
                }}
              />
            </div>
          </div>
        )}

        {error !== null && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {busy && (
          <p className="form-status" role="status">
            Creating project...
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="button" disabled={busy} onClick={onCancel}>
            Cancel
          </button>
          <button type="submit" className="button button-primary" disabled={busy}>
            Create
          </button>
        </div>
      </form>
    </Dialog>
  );
}
