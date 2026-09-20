import { useEffect, useId, useRef, useState, type ReactNode } from 'react';

/**
 * A panel anchored under a trigger, on the browser's own top layer.
 *
 * The Popover API gives light dismiss, Escape and the top layer for free, so
 * none of that is reimplemented here. What it does not give is placement, so
 * the panel is measured and positioned when it opens and whenever the page
 * moves under it.
 */
export function AdminPopover({
  trigger,
  label,
  children,
  width = 272,
}: {
  /** Rendered inside the trigger button. */
  readonly trigger: ReactNode;
  readonly label: string;
  readonly children: (close: () => void) => ReactNode;
  readonly width?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const popoverId = useId();

  useEffect(() => {
    const panel = panelRef.current;
    const anchor = triggerRef.current;
    if (panel === null || anchor === null || !isOpen) return;

    const place = (): void => {
      const box = anchor.getBoundingClientRect();
      const height = panel.offsetHeight;
      // Below the trigger, unless the viewport has no room left down there.
      const below = box.bottom + 6;
      const top = below + height > window.innerHeight - 8 ? box.top - height - 6 : below;
      const left = Math.min(Math.max(8, box.left), window.innerWidth - width - 8);
      panel.style.top = `${String(Math.max(8, top))}px`;
      panel.style.left = `${String(left)}px`;
    };

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [isOpen, width]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="admin-popover__trigger"
        aria-label={label}
        // @ts-expect-error -- `popovertarget` is not in React's prop types yet.
        popovertarget={popoverId}
      >
        {trigger}
      </button>
      <div
        ref={panelRef}
        id={popoverId}
        className="admin-popover"
        style={{ width }}
        popover="auto"
        onToggle={(event: { readonly newState?: string }) => {
          setIsOpen(event.newState === 'open');
        }}
      >
        {children(() => panelRef.current?.hidePopover())}
      </div>
    </>
  );
}
