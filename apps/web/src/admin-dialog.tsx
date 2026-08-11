import { useEffect, useId, useRef, type ReactNode } from 'react';

interface FocusTarget {
  readonly current: HTMLElement | null;
}

export function AdminDialog({
  title,
  description,
  children,
  onCancel,
  initialFocusRef,
  returnFocusRef,
  canCancel = true,
  className = 'admin-dialog',
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  readonly onCancel: () => void;
  readonly initialFocusRef?: FocusTarget;
  readonly returnFocusRef?: FocusTarget;
  readonly canCancel?: boolean;
  readonly className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const descriptionId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    restoreFocusRef.current =
      returnFocusRef?.current ??
      (document.activeElement instanceof HTMLElement ? document.activeElement : null);
    if (!dialog.open) dialog.showModal();
    const focusTarget = initialFocusRef?.current ?? findFirstFocusable(dialog);
    requestAnimationFrame(() => focusTarget?.focus());

    return () => {
      if (dialog.open) dialog.close();
      const restoreTarget = restoreFocusRef.current;
      const restoreFocus = () => {
        if (restoreTarget?.isConnected) restoreTarget.focus({ preventScroll: true });
      };
      window.setTimeout(restoreFocus, 0);
      requestAnimationFrame(() => requestAnimationFrame(restoreFocus));
    };
  }, [initialFocusRef, returnFocusRef]);

  return (
    <dialog
      ref={dialogRef}
      className={className}
      aria-labelledby={titleId}
      aria-describedby={description === undefined ? undefined : descriptionId}
      onCancel={(event) => {
        event.preventDefault();
        if (canCancel) onCancel();
      }}
    >
      <div className="admin-dialog__header">
        <h2 id={titleId}>{title}</h2>
        <button
          type="button"
          className="admin-dialog__close"
          onClick={onCancel}
          aria-label="閉じる"
          disabled={!canCancel}
        >
          ×
        </button>
      </div>
      {description === undefined ? null : (
        <p id={descriptionId} className="admin-dialog__description">
          {description}
        </p>
      )}
      {children}
    </dialog>
  );
}

function findFirstFocusable(dialog: HTMLDialogElement): HTMLElement | null {
  return dialog.querySelector<HTMLElement>(
    '[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not(.admin-dialog__close), [tabindex]:not([tabindex="-1"])',
  );
}
