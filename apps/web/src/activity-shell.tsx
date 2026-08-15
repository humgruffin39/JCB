import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiRequestError, exchangeActivityAuthorization } from './api.js';
import {
  createDiscordActivityPlatform,
  type ActivityPlatform,
  type ActivityPlatformFactory,
} from './activity-platform.js';
import { PublicState, type PublicStateStatus } from './public-state.js';
import { RaceTerminal } from './race-terminal.js';

const browserEnvironment: unknown = import.meta.env;
const DISCORD_CLIENT_ID = readEnvironmentString(browserEnvironment, 'VITE_DISCORD_CLIENT_ID');
const ACTIVITY_READY_TIMEOUT_MS = 15_000;

type ActivityState =
  | { readonly status: 'connecting' }
  | { readonly status: 'authorizing' }
  | { readonly status: 'race'; readonly raceId: string }
  | { readonly status: 'unavailable'; readonly heading: string; readonly message: string }
  | { readonly status: 'error'; readonly heading: string; readonly message: string };

export interface ActivityShellProps {
  readonly createPlatform?: ActivityPlatformFactory;
}

export interface InitializedActivitySession {
  readonly raceId: string;
}

let defaultPlatform: ActivityPlatform | undefined;

export function ActivityShell({ createPlatform = defaultPlatformFactory }: ActivityShellProps) {
  const [state, setState] = useState<ActivityState>({ status: 'connecting' });
  const [attempt, setAttempt] = useState(0);
  const platformRef = useRef<ActivityPlatform | undefined>(undefined);

  const retry = useCallback(() => {
    setState({ status: 'connecting' });
    setAttempt((current) => current + 1);
  }, []);

  useEffect(() => {
    let active = true;
    let platform: ActivityPlatform | undefined;

    const start = async (): Promise<void> => {
      try {
        platform = createPlatform();
        platformRef.current = platform;
        await withTimeout(platform.ready(), ACTIVITY_READY_TIMEOUT_MS);
        if (!active) return;
        setState({ status: 'authorizing' });
        const session = await authorizeActivitySession(platform);
        if (!active) return;
        setState({ status: 'race', raceId: session.raceId });
      } catch (error) {
        if (active) setState(activityErrorState(error));
      }
    };

    const handleAuthExpired = (): void => {
      if (!active) return;
      setState({
        status: 'error',
        heading: '接続が切れました',
        message: 'もう一度接続すると、同じレースに戻れます。',
      });
    };
    window.addEventListener('jcb:auth-expired', handleAuthExpired);
    void start();

    return () => {
      active = false;
      window.removeEventListener('jcb:auth-expired', handleAuthExpired);
      if (platformRef.current === platform) platformRef.current = undefined;
      if (platform !== undefined) void platform.dispose();
    };
  }, [attempt, createPlatform]);

  if (state.status === 'race') return <RaceTerminal raceId={state.raceId} />;
  if (state.status === 'connecting') {
    return (
      <ActivityStatus status="loading" heading="ジョサン中央銀行" message="接続しています。" />
    );
  }
  if (state.status === 'authorizing') {
    return (
      <ActivityStatus
        status="loading"
        heading="ジョサン中央銀行"
        message="観戦準備をしています。"
      />
    );
  }
  return (
    <ActivityStatus
      status={state.status}
      heading={state.heading}
      message={state.message}
      {...(state.status === 'error' ? { onRetry: retry } : {})}
    />
  );
}

function ActivityStatus({
  status,
  heading,
  message,
  onRetry,
}: {
  readonly status: PublicStateStatus;
  readonly heading: string;
  readonly message: string;
  readonly onRetry?: () => void;
}) {
  return (
    <div className="activity-status">
      <PublicState status={status} heading={heading} message={message} />
      {onRetry === undefined ? null : (
        <button className="activity-status__retry" type="button" onClick={onRetry}>
          もう一度接続
        </button>
      )}
    </div>
  );
}

function defaultPlatformFactory(): ActivityPlatform {
  defaultPlatform ??= createDiscordActivityPlatform(DISCORD_CLIENT_ID);
  return defaultPlatform;
}

export async function authorizeActivitySession(
  platform: ActivityPlatform,
): Promise<InitializedActivitySession> {
  const authorization = await platform.authorize();
  const session = await exchangeActivityAuthorization({
    code: authorization.code,
    instanceId: platform.instanceId,
    ...(platform.launchId === undefined ? {} : { launchId: platform.launchId }),
    ...(platform.guildId === undefined ? {} : { guildId: platform.guildId }),
    ...(platform.channelId === undefined ? {} : { channelId: platform.channelId }),
  });
  await platform.authenticate(session.accessToken);
  return { raceId: session.raceId };
}

export function activityErrorState(error: unknown): ActivityState {
  if (error instanceof ApiRequestError) {
    if (error.code === 'GUILD_MEMBERSHIP_REQUIRED') {
      return {
        status: 'unavailable',
        heading: 'このサーバーでは観戦できません',
        message: 'ジョサン中央銀行のDiscordサーバーから開いてください。',
      };
    }
    if (
      error.code === 'ACTIVITY_LAUNCH_NOT_FOUND' ||
      error.code === 'ACTIVITY_INSTANCE_INVALID' ||
      error.code === 'RACE_NOT_FOUND'
    ) {
      return {
        status: 'unavailable',
        heading: '観戦するレースがありません',
        message: 'Discordのレース投稿から「観戦する」を押してください。',
      };
    }
    if (error.status === 429) {
      return {
        status: 'error',
        heading: '少し時間をおいてください',
        message: 'アクセスが集中しています。しばらくしてからもう一度お試しください。',
      };
    }
  }
  return {
    status: 'error',
    heading: '接続できませんでした',
    message: '通信を確認して、もう一度お試しください。',
  };
}

function readEnvironmentString(environment: unknown, key: string): string {
  if (typeof environment !== 'object' || environment === null || !(key in environment)) return '';
  const value = (environment as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

async function withTimeout<Result>(
  promise: Promise<Result>,
  milliseconds: number,
): Promise<Result> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error('Activity SDK timed out.')), milliseconds);
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
  }
}
