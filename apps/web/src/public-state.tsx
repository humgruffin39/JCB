export type PublicStateStatus = 'loading' | 'waiting' | 'error' | 'unavailable';

export interface PublicStateProps {
  readonly status: PublicStateStatus;
  readonly heading: string;
  readonly message?: string;
  readonly className?: string;
}

export function PublicState({ status, heading, message, className }: PublicStateProps) {
  const isStatusMessage = status === 'loading' || status === 'waiting';
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
    </section>
  );
}
