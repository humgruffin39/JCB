import { betResponseSchema } from '@jcb/contracts';
import { useEffect, useState } from 'react';
import { apiRequest, getResult } from './api.js';
import type { getRace } from './api.js';
import { publicErrorMessage } from './public-error-message.js';
import { createViewerRetryPolicy, viewerRetryDelay } from './race-viewer-retry.js';

export type RaceViewerResult = Awaited<ReturnType<typeof getResult>>;
export type RaceViewerBet = ReturnType<typeof betResponseSchema.parse>;
type RaceStatus = Awaited<ReturnType<typeof getRace>>['status'];

const RESULT_STATUSES: ReadonlySet<RaceStatus> = new Set(['finished', 'settling', 'settled']);

// Settlement runs on the scheduler a few seconds after the timeline ends, so the
// results screen is on show before payouts exist. Tickets fetched before then are
// still `open` with a zero payout, which would read as a losing ticket.
const SETTLEMENT_POLL_INTERVAL_MS = 4_000;
const SETTLEMENT_POLL_MAX_ATTEMPTS = 60;

export function hasUnsettledBet(bets: readonly RaceViewerBet[]): boolean {
  return bets.some((bet) => bet.status === 'open');
}

export function shouldFetchRaceResult(status: RaceStatus, resultRequested: boolean): boolean {
  return resultRequested || RESULT_STATUSES.has(status);
}

export function raceResultRetryDelay(failureCount: number): number {
  return viewerRetryDelay(failureCount);
}

export function useRaceViewerData({
  raceId,
  raceStatus,
  resultRequested,
}: {
  readonly raceId: string;
  readonly raceStatus: RaceStatus;
  readonly resultRequested: boolean;
}) {
  const [bets, setBets] = useState<readonly RaceViewerBet[]>([]);
  const [betsLoading, setBetsLoading] = useState(true);
  const [betsError, setBetsError] = useState<string>();
  const [result, setResult] = useState<RaceViewerResult>();
  const [resultError, setResultError] = useState<string>();

  const awaitingSettlement = shouldFetchRaceResult(raceStatus, resultRequested);

  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let attempts = 0;

    const scheduleRetry = (shouldRetry: boolean): void => {
      if (!shouldRetry || cancelled || !awaitingSettlement) return;
      if (attempts >= SETTLEMENT_POLL_MAX_ATTEMPTS) return;
      timer = window.setTimeout(() => void load(), SETTLEMENT_POLL_INTERVAL_MS);
    };

    const load = async (): Promise<void> => {
      if (cancelled) return;
      attempts += 1;
      try {
        const value = betResponseSchema
          .array()
          .parse(await apiRequest<unknown>(`/api/v1/races/${encodeURIComponent(raceId)}/my-bets`));
        if (cancelled) return;
        setBets(value);
        setBetsLoading(false);
        setBetsError(undefined);
        scheduleRetry(hasUnsettledBet(value));
      } catch (error) {
        if (cancelled) return;
        setBetsLoading(false);
        // A failed refresh leaves the tickets already on screen alone.
        if (attempts === 1) {
          setBetsError(
            publicErrorMessage(
              error,
              '購入情報を取得できません。Discordの#競馬から観戦リンクを開き直してください。',
            ),
          );
        }
        scheduleRetry(true);
      }
    };

    void load();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [raceId, awaitingSettlement]);

  useEffect(() => {
    setResult(undefined);
    setResultError(undefined);
  }, [raceId]);

  useEffect(() => {
    let cancelled = false;
    let retryTimer: number | undefined;
    const retryPolicy = createViewerRetryPolicy();
    setResultError(undefined);
    if (!shouldFetchRaceResult(raceStatus, resultRequested) || result !== undefined) return;

    const loadResult = async (): Promise<void> => {
      if (cancelled) return;
      try {
        const value = await getResult(raceId);
        if (!cancelled) {
          retryPolicy.stop();
          setResult(value);
          setResultError(undefined);
        }
      } catch (error) {
        if (!cancelled) {
          setResultError('公式結果を取得できませんでした。通信状態を確認してください。');
          const retryDelay = retryPolicy.nextDelay(error);
          if (retryDelay !== undefined) {
            retryTimer = window.setTimeout(() => void loadResult(), retryDelay);
          }
        }
      }
    };

    void loadResult();
    return () => {
      cancelled = true;
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
  }, [raceId, raceStatus, result, resultRequested]);

  return { bets, betsLoading, betsError, result, resultError } as const;
}
