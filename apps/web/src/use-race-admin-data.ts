import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest } from './api.js';
import { useAdminToast } from './admin-toaster.js';
import { useAdminPolling } from './use-admin-polling.js';
import {
  DEFAULT_SCHEDULE,
  type AdminRace,
  type HorseOption,
  type ScheduleSettings,
} from './race-admin-model.js';

export interface UseRaceAdminData {
  readonly races: readonly AdminRace[];
  readonly horses: readonly HorseOption[];
  readonly schedule: ScheduleSettings;
  readonly isInitialLoading: boolean;
  readonly refreshError: string | undefined;
  readonly formOptionsError: string;
  readonly operationError: string;
  readonly pendingOperation: string | undefined;
  readonly refresh: () => Promise<void>;
  readonly transition: (race: AdminRace, operation: 'lock' | 'unlock') => Promise<void>;
  readonly retry: (race: AdminRace, operation: 'simulation' | 'settlement') => Promise<void>;
  readonly rehearseNow: (race: AdminRace) => Promise<void>;
  readonly cancelRace: (race: AdminRace, reason: string) => Promise<void>;
}

interface AdminSettingsResponse {
  readonly gameSettings: ScheduleSettings;
}

export function useRaceAdminData(): UseRaceAdminData {
  const [races, setRaces] = useState<readonly AdminRace[]>([]);
  const raceRequestId = useRef(0);
  const [horses, setHorses] = useState<readonly HorseOption[]>([]);
  const [schedule, setSchedule] = useState<ScheduleSettings>(DEFAULT_SCHEDULE);
  const [formOptionsError, setFormOptionsError] = useState('');
  const [operationError, setOperationError] = useState('');
  const [pendingOperation, setPendingOperation] = useState<string>();
  const { success } = useAdminToast();

  const refreshRaces = useCallback(async () => {
    const requestId = raceRequestId.current + 1;
    raceRequestId.current = requestId;
    const nextRaces = await apiRequest<readonly AdminRace[]>('/api/v1/admin/races', {
      cache: 'no-store',
    });
    if (requestId === raceRequestId.current) setRaces(nextRaces);
  }, []);

  const refreshFormOptions = useCallback(async () => {
    try {
      const [horseRows, adminSettings] = await Promise.all([
        apiRequest<readonly HorseOption[]>('/api/v1/admin/horses'),
        apiRequest<AdminSettingsResponse>('/api/v1/admin/settings'),
      ]);
      setHorses(horseRows);
      const settings = adminSettings.gameSettings;
      setSchedule({
        recommendedLockTime: settings.recommendedLockTime,
        viewerOpenTime: settings.viewerOpenTime,
        bettingCloseTime: settings.bettingCloseTime,
        startTime: settings.startTime,
      });
      setFormOptionsError('');
    } catch (caught) {
      setFormOptionsError(caught instanceof Error ? caught.message : '入力候補を取得できません。');
      throw caught;
    }
  }, []);

  const {
    isInitialLoading,
    error: refreshError,
    refreshNow,
  } = useAdminPolling(refreshRaces, 5_000);

  const refresh = useCallback(async () => {
    await refreshNow();
    await refreshFormOptions().catch(() => undefined);
  }, [refreshFormOptions, refreshNow]);

  useEffect(() => {
    void refreshFormOptions().catch(() => undefined);
  }, [refreshFormOptions]);

  async function runRaceOperation(
    race: AdminRace,
    operation: string,
    action: () => Promise<void>,
    successMessage: string,
  ): Promise<boolean> {
    if (pendingOperation !== undefined) return false;
    setPendingOperation(`${race.id}:${operation}`);
    setOperationError('');
    try {
      await action();
      success(successMessage);
      await refresh();
      return true;
    } catch (caught) {
      setOperationError(caught instanceof Error ? caught.message : '操作を完了できません。');
      return false;
    } finally {
      setPendingOperation(undefined);
    }
  }

  async function transition(race: AdminRace, operation: 'lock' | 'unlock'): Promise<void> {
    await runRaceOperation(
      race,
      operation,
      async () => {
        await apiRequest(`/api/v1/admin/races/${race.id}/${operation}`, {
          method: 'POST',
          body: '{}',
        });
      },
      operation === 'lock'
        ? 'レースを確定し、シミュレーションを予約しました。'
        : 'レースを下書きへ戻しました。',
    );
  }

  async function retry(race: AdminRace, operation: 'simulation' | 'settlement'): Promise<void> {
    await runRaceOperation(
      race,
      `retry-${operation}`,
      async () => {
        await apiRequest(`/api/v1/admin/races/${race.id}/retry-${operation}`, {
          method: 'POST',
          body: '{}',
        });
      },
      operation === 'simulation'
        ? 'シミュレーションの再試行を予約しました。'
        : '精算の再試行を予約しました。',
    );
  }

  async function rehearseNow(race: AdminRace): Promise<void> {
    const succeeded = await runRaceOperation(
      race,
      'rehearse-now',
      async () => {
        await apiRequest(`/api/v1/admin/races/${race.id}/rehearse-now`, {
          method: 'POST',
          body: '{}',
        });
      },
      'リハーサルを精算まで進めました。',
    );
    if (!succeeded) throw new Error('操作を完了できません。画面のエラーを確認してください。');
  }

  async function cancelRace(race: AdminRace, reason: string): Promise<void> {
    const succeeded = await runRaceOperation(
      race,
      'cancel',
      async () => {
        await apiRequest(`/api/v1/admin/races/${race.id}/cancel`, {
          method: 'POST',
          body: JSON.stringify({ reason }),
        });
      },
      'レースを中止し、購入済み馬券を全額返金しました。',
    );
    if (!succeeded) throw new Error('操作を完了できません。画面のエラーを確認してください。');
  }

  return {
    races,
    horses,
    schedule,
    isInitialLoading,
    refreshError,
    formOptionsError,
    operationError,
    pendingOperation,
    refresh,
    transition,
    retry,
    rehearseNow,
    cancelRace,
  };
}
