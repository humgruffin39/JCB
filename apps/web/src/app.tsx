import { useEffect, useState } from 'react';
import { AdminTerminal } from './admin-terminal.js';
import { apiAbsoluteUrl, apiRequest, exchangeTicket, getRace, refreshCsrfToken } from './api.js';
import { RaceTerminal } from './race-terminal.js';

type AppState =
  | { readonly status: 'loading' }
  | { readonly status: 'needs-discord' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'race'; readonly raceId: string };

export function App() {
  const [state, setState] = useState<AppState>({ status: 'loading' });
  const isAdmin = window.location.pathname.startsWith('/admin');
  const isRace =
    !isAdmin && (state.status === 'race' || window.location.pathname.startsWith('/races/'));

  useEffect(() => {
    if (isAdmin) return;
    void initialize().then(setState);
  }, [isAdmin]);

  return (
    <div
      className={`app-shell${isAdmin ? ' app-shell--admin' : ''}${isRace ? ' app-shell--race' : ''}`}
    >
      {isRace ? null : (
        <header className="masthead">
          <h1>{isAdmin ? '競馬BOT 管理' : 'ジョサン中央銀行 競馬'}</h1>
        </header>
      )}
      <main id="main">
        {isAdmin ? (
          <AdminGate />
        ) : state.status === 'loading' ? (
          <LoadingState />
        ) : state.status === 'needs-discord' ? (
          <AccessState />
        ) : state.status === 'error' ? (
          <ErrorState message={state.message} />
        ) : (
          <RaceTerminal raceId={state.raceId} />
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
  if (status === 'checking') return <LoadingState />;
  return (
    <section className="terminal-state">
      <h2>管理者ログイン</h2>
      <p>所属ギルドと管理者許可リストを確認した後、管理制御盤を開きます。</p>
      <a className="primary-link" href={apiAbsoluteUrl('/api/v1/auth/discord/start')}>
        Discordで認証する
      </a>
    </section>
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
          message: 'レース情報がありません。Discordから開き直してください。',
        };
      }
      localStorage.setItem('jcb.last-race', raceId);
      window.history.replaceState(null, '', `/races/${encodeURIComponent(raceId)}`);
      return { status: 'race', raceId };
    }
    const pathMatch = /^\/races\/([^/]+)/.exec(window.location.pathname);
    const raceId =
      pathMatch === null
        ? localStorage.getItem('jcb.last-race')
        : decodeURIComponent(pathMatch[1]!);
    if (raceId === null) return { status: 'needs-discord' };
    await getRace(raceId);
    return { status: 'race', raceId };
  } catch (error) {
    return {
      status: 'error',
      message:
        error instanceof Error
          ? `${error.message} Discordから新しいリンクを発行して開き直してください。`
          : 'レースを読み込めません。Discordから開き直してください。',
    };
  }
}

function LoadingState() {
  return (
    <section className="terminal-state" aria-live="polite" aria-busy="true">
      <h2>読み込み中</h2>
      <p>認証とレース情報を確認しています。</p>
    </section>
  );
}

function AccessState() {
  return (
    <section className="terminal-state">
      <h2>Discordから開いてください</h2>
      <p>
        レースチャンネルの「詳細を見る」または「観戦する」から、一回限りのリンクを発行してください。
      </p>
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
