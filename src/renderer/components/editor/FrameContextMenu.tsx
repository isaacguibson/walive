import { useEffect, useRef } from 'react';

export type FrameAction = 'copy' | 'cut' | 'paste' | 'duplicate' | 'clear' | 'remove';

interface MenuItem {
  action: FrameAction;
  label: string;
}

const MENU_ITEMS: readonly MenuItem[] = [
  { action: 'copy', label: 'Copy' },
  { action: 'cut', label: 'Cut' },
  { action: 'paste', label: 'Paste' },
  { action: 'duplicate', label: 'Duplicate' },
  { action: 'clear', label: 'Clear' },
  { action: 'remove', label: 'Remove' }
];

const MENU_WIDTH = 180;
const MENU_HEIGHT = 230;

interface FrameContextMenuProps {
  x: number;
  y: number;
  canPaste: boolean;
  onAction(action: FrameAction): void;
  onClose(): void;
}

/** Floating menu for the frame that was right-clicked. */
export function FrameContextMenu({ x, y, canPaste, onAction, onClose }: FrameContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button:not(:disabled)')?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (ref.current !== null && event.target instanceof Node && !ref.current.contains(event.target)) {
        onClose();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('blur', onClose);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('blur', onClose);
      window.removeEventListener('resize', onClose);
    };
  }, [onClose]);

  const left = Math.max(0, Math.min(x, window.innerWidth - MENU_WIDTH));
  const top = Math.max(0, Math.min(y, window.innerHeight - MENU_HEIGHT));

  return (
    <div
      ref={ref}
      className="context-menu"
      role="menu"
      aria-label="Frame actions"
      style={{ left, top }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      {MENU_ITEMS.map((item) => (
        <button
          key={item.action}
          type="button"
          role="menuitem"
          className="context-menu-item"
          disabled={item.action === 'paste' && !canPaste}
          onClick={() => {
            onAction(item.action);
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
