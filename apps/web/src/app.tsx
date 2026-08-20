import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import {
  ApiRequestError,
  apiAbsoluteUrl,
  apiRequest,
  clearCsrfToken,
  exchangeTicket,
  getRace,
  refreshCsrfToken,
  setCsrfToken,
} from './api.js';
import { initializationErrorMessage as getInitializationErrorMessage } from './public-error-message.js';
import { PublicState } from './public-state.js';
import { isDiscordActivityLaunch } from './activity-launch.js';

const ACCESS_REDIRECT_URL = 'https://youtu.be/dQw4w9WgXcQ';

const AdminTerminal = lazy(async () => {
  const module = await import('./admin-terminal.js');
  return { default: module.AdminTerminal };
});
const RaceTerminal = lazy(async () => {
  const module = await import('./race-terminal.js');
  return { default: module.RaceTerminal };
});
const ActivityShell = lazy(async () => {
  const module = await import('./activity-shell.js');
  return { default: module.ActivityShell };
});

type AppState =
  | { readonly status: 'loading' }
  | { readonly status: 'needs-discord' }
  | { readonly status: 'error'; readonly message: string }
  | { readonly status: 'race'; readonly raceId: string };

export function App() {
  const [state, setState] = useState<AppState>({ status: 'loading' });
  const isAdmin = isAdminPathname(window.location.pathname);
  const isActivity = !isAdmin && isDiscordActivityLaunch(window.location.search);
  const isRace =
    !isAdmin &&
    (state.status === 'race' || raceIdFromPathname(window.location.pathname) !== undefined);
  const isState = !isAdmin && !isRace;

  useEffect(() => {
    if (isAdmin || isActivity) return;
    let active = true;
    let sessionExpired = false;
    const handleAuthExpired = () => {
      sessionExpired = true;
      clearCsrfToken('race');
      for (let index = sessionStorage.length - 1; index >= 0; index -= 1) {
        const key = sessionStorage.key(index);
        if (key?.startsWith('jcb.edge-token:')) sessionStorage.removeItem(key);
      }
      setState({ status: 'needs-discord' });
    };
    window.addEventListener('jcb:auth-expired', handleAuthExpired);
    void initialize().then((nextState) => {
      if (active && !sessionExpired) setState(nextState);
    });
    return () => {
      active = false;
      window.removeEventListener('jcb:auth-expired', handleAuthExpired);
    };
  }, [isActivity, isAdmin]);

  if (isActivity) {
    return (
      <div className="app-shell app-shell--race app-shell--activity">
        <main id="main">
          <Suspense fallback={<LoadingState />}>
            <ActivityShell />
          </Suspense>
        </main>
      </div>
    );
  }

  if (!isAdmin && state.status === 'needs-discord') {
    return <AccessRedirect />;
  }

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
          <Suspense fallback={null}>
            <AdminGate />
          </Suspense>
        ) : state.status === 'loading' ? (
          <LoadingState />
        ) : state.status === 'needs-discord' ? (
          <AccessRedirect />
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
          <span>チャレンジャーポイントは実通貨と交換できません</span>
        </footer>
      )}
    </div>
  );
}

function AdminGate() {
  const [isAuthorized, setIsAuthorized] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string>();
  const isRedirecting = useRef(false);

  useEffect(() => {
    let active = true;
    const redirectToDiscord = (): void => {
      if (isRedirecting.current) return;
      isRedirecting.current = true;
      window.location.replace(apiAbsoluteUrl('/api/v1/auth/discord/start'));
    };
    const handleAuthExpired = (): void => {
      clearCsrfToken('admin');
      redirectToDiscord();
    };
    window.addEventListener('jcb:auth-expired', handleAuthExpired);

    const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const csrfToken = fragment.get('csrf');
    if (csrfToken !== null) {
      setCsrfToken('admin', csrfToken);
      window.history.replaceState(null, '', '/admin');
    }
    void apiRequest<unknown>('/api/v1/admin/health')
      .then(() => refreshCsrfToken('admin'))
      .then(() => {
        if (active) setIsAuthorized(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        clearCsrfToken('admin');
        if (isAdminAuthenticationError(error)) {
          redirectToDiscord();
          return;
        }
        setErrorMessage(adminGateErrorMessage(error));
      });

    return () => {
      active = false;
      window.removeEventListener('jcb:auth-expired', handleAuthExpired);
    };
  }, []);

  if (isAuthorized) return <AdminTerminal />;
  if (errorMessage !== undefined) {
    return <PublicState status="error" heading="管理画面を読み込めません" message={errorMessage} />;
  }
  return null;
}

function isAdminAuthenticationError(error: unknown): boolean {
  return error instanceof ApiRequestError && (error.status === 401 || error.status === 403);
}

function adminGateErrorMessage(error: unknown): string {
  if (error instanceof ApiRequestError && error.status === 429) {
    return 'アクセスが集中しています。少し待ってから開き直してください。';
  }
  return '管理画面に接続できません。時間をおいて開き直してください。';
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
      message: getInitializationErrorMessage(error),
    };
  }
}

export { initializationErrorMessage } from './public-error-message.js';

export function raceIdFromPathname(pathname: string): string | undefined {
  const pathMatch = /^\/races\/([^/]+)\/?$/.exec(pathname);
  if (pathMatch === null) return undefined;
  try {
    return decodeURIComponent(pathMatch[1]!);
  } catch {
    return undefined;
  }
}

export function isAdminPathname(pathname: string): boolean {
  return /^\/admin(?:\/|$)/.test(pathname);
}

function LoadingState() {
  return <PublicState status="loading" heading="レース映像を準備中" />;
}

function AccessRedirect() {
  const isRedirecting = useRef(false);

  useEffect(() => {
    if (isRedirecting.current) return;
    isRedirecting.current = true;
    window.location.replace(ACCESS_REDIRECT_URL);
  }, []);

  return null;
}

function ErrorState({ message }: { readonly message: string }) {
  return <PublicState status="error" heading="レースを読み込めません" message={message} />;
}
