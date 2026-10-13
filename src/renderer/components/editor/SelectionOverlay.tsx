import type { DOMAttributes } from 'react';
import type { SelectionState } from '@editor/model';
import { RESIZE_HANDLES, RESIZE_HANDLE_LABELS } from '@editor/placement';

/** Room around the canvas where the overlay still takes the pointer, so handles on its border stay reachable. */
const BORDER_MARGIN = 14;

interface SelectionOverlayProps {
  selection: SelectionState;
  width: number;
  height: number;
  /** The pointer handlers of the canvas: the overlay covers it, so it must route the input the same way. */
  pointerHandlers: Pick<
    DOMAttributes<HTMLDivElement>,
    'onPointerDown' | 'onPointerMove' | 'onPointerUp' | 'onPointerCancel' | 'onLostPointerCapture'
  >;
}

/**
 * Outline and resize handles of the selection, above the canvas. They are plain elements, never
 * part of the drawing, and keep their on-screen size at any zoom. Hit testing is done by the
 * editor from the pointer position; the handles only give the cursor and the look.
 */
export function SelectionOverlay({ selection, width, height, pointerHandlers }: SelectionOverlayProps) {
  const { rect, creating, pending } = selection;
  return (
    <div
      className="selection-overlay"
      data-testid="selection-overlay"
      style={{ inset: -BORDER_MARGIN }}
      {...pointerHandlers}
    >
      <div className="selection-area" style={{ inset: BORDER_MARGIN }}>
        <div
          className="selection-box"
          data-testid="selection-box"
          data-creating={creating ? 'true' : 'false'}
          data-pending={pending ? 'true' : 'false'}
          style={{
            left: `${(rect.x / width) * 100}%`,
            top: `${(rect.y / height) * 100}%`,
            width: `${(rect.width / width) * 100}%`,
            height: `${(rect.height / height) * 100}%`
          }}
        >
          {!creating &&
            RESIZE_HANDLES.map((handle) => (
              <div
                key={handle}
                className={`placement-handle placement-handle-${handle}`}
                data-testid={`selection-handle-${handle}`}
                title={`Resize ${RESIZE_HANDLE_LABELS[handle]}`}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
