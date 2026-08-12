import { lazy, Suspense, useEffect, useState } from 'react';
import { apiAbsoluteUrl, apiRequest, exchangeTicket, getRace, refreshCsrfToken } from './api.js';

const DISCORD_RACE_CHANNEL_URL =
  'https://discord.com/channels/1329013463175139380/1533526967217815735';

const AdminTerminal = lazy(async () => {
  const module = await import('./admin-terminal.js');
  return { default: module.AdminTerminal };
});
const RaceTerminal = lazy(async () => {
  const module = await import('./race-terminal.js');
  return { default: module.RaceTerminal };
});

type AppState =
  | { readonly status: 'loading' }
  | { readonly status: 'needs-discord'; readonly reason?: 'session-expired' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'race'; readonly raceId: string };

export function App() {
  const [state, setState] = useState<AppState>({ status: 'loading' });
  const isAdmin = window.location.pathname.startsWith('/admin');
  const isRace =
    !isAdmin && (state.status === 'race' || window.location.pathname.startsWith('/races/'));
  const isState = !isAdmin && !isRace;

  useEffect(() => {
    if (isAdmin) return;
    let active = true;
    let sessionExpired = false;
    const handleAuthExpired = () => {
      sessionExpired = true;
      sessionStorage.removeItem('jcb.csrf');
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith('jcb.edge-token:')) sessionStorage.removeItem(key);
      }
      setState({ status: 'needs-discord', reason: 'session-expired' });
    };
    window.addEventListener('jcb:auth-expired', handleAuthExpired);
    void initialize().then((nextState) => {
      if (active && !sessionExpired) setState(nextState);
    });
    return () => {
      active = false;
      window.removeEventListener('jcb:auth-expired', handleAuthExpired);
    };
  }, [isAdmin]);

  return (
    <div
      className={`app-shell${isAdmin ? ' app-shell--admin' : ''}${isRace ? ' app-shell--race' : ''}${isState ? ' app-shell--state' : ''}`}
    >
      {isRace || isAdmin ? null : (
        <header className="masthead">
          <h1>ジョサン中央銀行 競馬</h1>
        </header>
      )}
      <main id="main">
        {isAdmin ? (
          <Suspense fallback={<LoadingState admin />}>
            <AdminGate />
          </Suspense>
        ) : state.status === 'loading' ? (
          <LoadingState />
        ) : state.status === 'needs-discord' ? (
          <AccessState sessionExpired={state.reason === 'session-expired'} />
        ) : state.status === 'error' ? (
          <ErrorState message={state.message} />
        ) : (
          <Suspense fallback={<LoadingState />}>
            <RaceTerminal raceId={state.raceId} />
          </Suspense>
        )}
      </main>
      {isAdmin || isRace ? null : (
        <footer className="footer-strip">
          <span>Discordサーバー参加者限定</span>
          <span>ルピーは実通貨と交換できません</span>
        </footer>
      )}
    </div>
  );
}

function AdminGate() {
  const [status, setStatus] = useState<'checking' | 'authorized' | 'login'>('checking');

  useEffect(() => {
    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const csrfToken = fragment.get('csrf');
    if (csrfToken !== null) {
      sessionStorage.setItem('jcb.csrf', csrfToken);
      window.history.replaceState(null, '', '/admin');
    }
    void apiRequest<unknown>('/api/v1/admin/health')
      .then(refreshCsrfToken)
      .then(() => setStatus('authorized'))
      .catch(() => {
        sessionStorage.removeItem('jcb.csrf');
        setStatus('login');
      });
  }, []);

  if (status === 'authorized') return <AdminTerminal />;
  if (status === 'checking') return <LoadingState admin />;
  return (
    <div className="terminal-state admin-auth-state">
      <a className="primary-link" href={apiAbsoluteUrl('/api/v1/auth/discord/start')}>
        認証する
      </a>
    </div>
  );
}

async function initialize(): Promise<AppState> {
  try {
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const ticket = hash.get('ticket');
    const hashRaceId = hash.get('raceId');
    if (ticket !== null) {
      window.history.replaceState(null, '', window.location.pathname);
      const exchanged = await exchangeTicket(ticket);
      const raceId = exchanged.raceId ?? hashRaceId;
      if (raceId === null || raceId === undefined) {
        return {
          status: 'error',
          message: 'レース情報がありません。Discordの#競馬から開き直してください。',
        };
      }
      window.history.replaceState(null, '', `/races/${encodeURIComponent(raceId)}`);
      return { status: 'race', raceId };
    }
    const raceId = raceIdFromPathname(window.location.pathname);
    if (raceId === undefined) return { status: 'needs-discord' };
    await getRace(raceId);
    return { status: 'race', raceId };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? `${error.message} Discordの#競馬から新しいリンクを発行して開き直してください。`
          : 'レースを読み込めません。Discordの#競馬から開き直してください。',
    };
  }
}

export function raceIdFromPathname(pathname: string): string | undefined {
  const pathMatch = /^\/races\/([^/]+)/.exec(pathname);
  return pathMatch === null ? undefined : decodeURIComponent(pathMatch[1]!);
}

function LoadingState({ admin = false }: { readonly admin?: boolean }) {
  return (
    <section
      className={`terminal-state${admin ? ' admin-auth-state' : ''}`}
      aria-live="polite"
      aria-busy="true"
    >
      <h2>読み込み中</h2>
      {admin ? null : <p>認証とレース情報を確認しています。</p>}
    </section>
  );
}

function AccessState({ sessionExpired = false }: { readonly sessionExpired?: boolean }) {
  return (
    <section className="terminal-state">
      <h2>{sessionExpired ? '認証の有効期限が切れました' : 'Discordから開いてください'}</h2>
      <p>
        Discordの{' '}
        <a
          className="channel-link"
          href={DISCORD_RACE_CHANNEL_URL}
          target="_blank"
          rel="noreferrer"
        >
          #競馬
        </a>{' '}
        の「観戦する」から、一回限りのリンクを発行してください。
      </p>
      <a className="primary-link" href={DISCORD_RACE_CHANNEL_URL} target="_blank" rel="noreferrer">
        #競馬を開く
      </a>
    </section>
  );
}

function ErrorState({ message }: { readonly message: string }) {
  return (
    <section className="terminal-state terminal-state--error" role="alert">
      <h2>レースを読み込めません</h2>
      <p>{message}</p>
    </section>
  );
}
