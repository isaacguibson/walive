import { useEffect, useId, useRef, useState } from 'react';
import { MAX_ADD_FRAMES } from '@editor/constants';
import { parseWholeNumber } from '@editor/validation';

interface AddFramesPopoverProps {
  onAdd(count: number): boolean;
  onClose(): void;
}

/** Floating panel to add several blank frames after the active frame. */
export function AddFramesPopover({ onAdd, onClose }: AddFramesPopoverProps) {
  const [value, setValue] = useState('5');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputId = useId();

  useEffect(() => {
    ref.current?.querySelector('input')?.select();
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current !== null && event.target instanceof Node && !ref.current.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [onClose]);

  function submit() {
    const count = parseWholeNumber(value);
    if (count === null) {
      setError('Enter a whole number greater than 0.');
      return;
    }
    if (count > MAX_ADD_FRAMES) {
      setError(`You can add at most ${MAX_ADD_FRAMES} frames at once.`);
      return;
    }
    if (onAdd(count)) {
      onClose();
    }
  }

  return (
    <div
      ref={ref}
      className="popover"
      role="dialog"
      aria-label="Add Frames"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <h3 className="popover-title">Add Frames</h3>
      <div className="field">
        <label htmlFor={inputId}>Quantity</label>
        <input
          id={inputId}
          type="text"
          inputMode="numeric"
          value={value}
          aria-invalid={error !== null}
          onChange={(event) => {
            setValue(event.target.value);
            setError(null);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
        {error !== null && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
      </div>
      <button type="button" className="button button-primary button-small" onClick={submit}>
        Add
      </button>
    </div>
  );
}
