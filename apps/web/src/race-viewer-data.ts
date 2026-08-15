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

  useEffect(() => {
    let cancelled = false;
    setBets([]);
    setBetsLoading(true);
    setBetsError(undefined);
    void apiRequest<unknown>(`/api/v1/races/${encodeURIComponent(raceId)}/my-bets`)
      .then((value) => betResponseSchema.array().parse(value))
      .then((value) => {
        if (cancelled) return;
        setBets(value);
        setBetsLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setBetsLoading(false);
        setBetsError(
          publicErrorMessage(
            error,
            '購入情報を取得できません。Discordの#競馬から観戦リンクを開き直してください。',
          ),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [raceId]);

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
