import type { HTMLAttributes, ReactNode } from 'react';

export interface TerminalPanelProps extends HTMLAttributes<HTMLElement> {
  readonly heading: string;
  readonly status?: string;
  readonly headerAction?: ReactNode;
  readonly children: ReactNode;
  readonly as?: 'section' | 'article';
}

export function TerminalPanel({
  heading,
  status,
  headerAction,
  children,
  as: Element = 'section',
  className = '',
  ...properties
}: TerminalPanelProps) {
  return (
    <Element className={`terminal-panel ${className}`.trim()} {...properties}>
      <header className="terminal-panel__header">
        <div className="terminal-panel__heading">
          <h2>{heading}</h2>
          {status === undefined ? null : <span className="status-readout">{status}</span>}
        </div>
        {headerAction === undefined ? null : (
          <div className="terminal-panel__header-actions">{headerAction}</div>
        )}
      </header>
      <div className="terminal-panel__body">{children}</div>
    </Element>
  );
}
