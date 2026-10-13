import { useEffect, useRef, type ReactNode } from 'react';

interface DialogProps {
  title: string;
  titleId: string;
  /** Extra class for dialogs that need more room than the default width. */
  className?: string;
  onCancel(): void;
  children: ReactNode;
}

/** Modal dialog with Escape-to-close and focus moved inside on open. */
export function Dialog({ title, titleId, className, onCancel, children }: DialogProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const focusable = ref.current?.querySelector<HTMLElement>('input, button');
    focusable?.focus();
    return () => previouslyFocused?.focus?.();
  }, []);

  return (
    <div className="dialog-backdrop">
      <div
        ref={ref}
        className={className === undefined ? 'dialog' : `dialog ${className}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            onCancel();
          }
        }}
      >
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>
  );
}
