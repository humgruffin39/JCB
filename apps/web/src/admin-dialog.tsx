import { useEffect, useId, useRef, type ReactNode } from 'react';
import { CloseIcon } from './admin-icons.js';

interface FocusTarget {
  readonly current: HTMLElement | null;
}

export function AdminDialog({
  title,
  description,
  children,
  footer,
  onCancel,
  initialFocusRef,
  returnFocusRef,
  canCancel = true,
  className = 'admin-dialog',
}: {
  readonly title: string;
  readonly description?: string;
  readonly children: ReactNode;
  /**
   * The buttons that close the dialog. They sit outside the scrolling body, so
   * a form long enough to scroll cannot carry them off the bottom edge. A
   * submit in here belongs to the form by its `form` attribute.
   */
  readonly footer?: ReactNode;
  readonly onCancel: () => void;
  readonly initialFocusRef?: FocusTarget;
  readonly returnFocusRef?: FocusTarget;
  readonly canCancel?: boolean;
  readonly className?: string;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const backdropMouseDown = useRef(false);
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
      /*
       * The backdrop is not an element, so a click on it is reported against
       * the dialog. Comparing the target to the dialog is not enough, because
       * the dialog's own padding answers to that too; the pointer has to be
       * outside the box the dialog actually occupies.
       */
      onMouseDown={(event) => {
        backdropMouseDown.current = isOutside(event, dialogRef.current);
      }}
      onClick={(event) => {
        const startedOutside = backdropMouseDown.current;
        backdropMouseDown.current = false;
        // A drag that began inside and ended outside is a text selection
        // running past the edge, not a click on the backdrop.
        if (!startedOutside || !isOutside(event, dialogRef.current)) return;
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
          <CloseIcon size={15} ariaHidden />
        </button>
      </div>
      {description === undefined ? null : (
        <p id={descriptionId} className="admin-dialog__description">
          {description}
        </p>
      )}
      <div className="admin-dialog__body scroll-area">{children}</div>
      {footer === undefined ? null : <div className="admin-dialog__footer">{footer}</div>}
    </dialog>
  );
}

function findFirstFocusable(dialog: HTMLDialogElement): HTMLElement | null {
  return dialog.querySelector<HTMLElement>(
    '[autofocus], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]):not(.admin-dialog__close), [tabindex]:not([tabindex="-1"])',
  );
}

/**
 * Whether a pointer event landed outside the dialog's box. A keyboard-driven
 * click reports no coordinates at all, and those are never a backdrop click.
 */
function isOutside(
  event: { readonly clientX: number; readonly clientY: number; readonly detail: number },
  dialog: HTMLDialogElement | null,
): boolean {
  if (dialog === null || event.detail === 0) return false;
  const box = dialog.getBoundingClientRect();
  return (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  );
}
