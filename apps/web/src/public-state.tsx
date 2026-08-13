export type PublicStateStatus = 'loading' | 'waiting' | 'error' | 'unavailable';

export interface PublicStateProps {
  readonly status: PublicStateStatus;
  readonly heading: string;
  readonly message?: string;
  readonly actionLabel?: string;
  readonly onAction?: () => void;
  readonly className?: string;
}

const DEFAULT_ACTION_LABEL = '再試行';

export function PublicState({
  status,
  heading,
  message,
  actionLabel,
  onAction,
  className,
}: PublicStateProps) {
  const isStatusMessage = status === 'loading' || status === 'waiting';
  const trimmedActionLabel = actionLabel?.trim();
  const visibleActionLabel =
    trimmedActionLabel === undefined || trimmedActionLabel.length === 0
      ? DEFAULT_ACTION_LABEL
      : trimmedActionLabel;
  const extraClassName = className?.trim();
  const rootClassName =
    extraClassName === undefined || extraClassName.length === 0
      ? 'public-state'
      : `public-state ${extraClassName}`;

  return (
    <section
      className={rootClassName}
      data-state={status}
      role={isStatusMessage ? 'status' : 'alert'}
      aria-busy={status === 'loading' ? 'true' : undefined}
    >
      <h2 className="public-state__heading">{heading}</h2>
      {message === undefined ? null : <p className="public-state__message">{message}</p>}
      {onAction === undefined ? null : (
        <button className="public-state__action" type="button" onClick={onAction}>
          {visibleActionLabel}
        </button>
      )}
    </section>
  );
}
