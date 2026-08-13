import { useState, type FormEvent } from 'react';
import { AdminDialog } from './admin-dialog.js';
import { apiRequest } from './api.js';
import {
  DISTANCE_OPTIONS,
  type AdminRace,
  type HorseOption,
  type ScheduleSettings,
} from './race-admin-model.js';
import { entriesFor, moveTimestampToJstDate, raceKindForDate } from './race-admin-utils.js';

function shuffled<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomValue = new Uint32Array(1);
    crypto.getRandomValues(randomValue);
    const randomIndex = Math.floor((randomValue[0]! / 2 ** 32) * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex]!, result[index]!];
  }
  return result;
}

export interface RaceFormProps {
  readonly horses: readonly HorseOption[];
  readonly schedule: ScheduleSettings;
  readonly race?: AdminRace;
  readonly onSaved: () => Promise<void>;
  readonly onCancel: () => void;
  readonly returnFocusRef: { readonly current: HTMLElement | null };
}

export function RaceForm({
  horses,
  schedule,
  race,
  onSaved,
  onCancel,
  returnFocusRef,
}: RaceFormProps) {
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const selectedEntries = entriesFor(race);
  const selectedEntriesByNumber = new Map(
    selectedEntries.map((entry) => [entry.horseNumber, entry] as const),
  );
  const [selectedHorseIds, setSelectedHorseIds] = useState<readonly string[]>(() =>
    Array.from({ length: 8 }, (_, index) => selectedEntriesByNumber.get(index + 1)?.horseId ?? ''),
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSubmitting) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const raceDate = String(form.get('raceDate'));
    const entries = selectedHorseIds.map((horseId, index) => ({
      horseId,
      horseNumber: index + 1,
    }));
    if (
      entries.some((entry) => entry.horseId === '') ||
      new Set(entries.map((entry) => entry.horseId)).size !== 8
    ) {
      setError('8頭すべてに異なる馬を選んでください。');
      return;
    }
    if (
      entries.some(
        (entry) => horses.find((horse) => horse.id === entry.horseId)?.status === 'retired',
      )
    ) {
      setError('引退した馬は出走馬にできません。別の馬へ交換してください。');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      await apiRequest(
        race === undefined ? '/api/v1/admin/races' : `/api/v1/admin/races/${race.id}`,
        {
          method: race === undefined ? 'POST' : 'PATCH',
          body: JSON.stringify({
            raceDate,
            name: String(form.get('name')),
            ...(String(form.get('kind')) === ''
              ? race === undefined
                ? {}
                : { kind: raceKindForDate(raceDate) }
              : { kind: String(form.get('kind')) }),
            distanceM: Number(form.get('distanceM')),
            surface: String(form.get('surface')),
            scheduledAt:
              race === undefined
                ? Date.parse(`${raceDate}T${schedule.startTime}+09:00`)
                : moveTimestampToJstDate(race.scheduledAt, raceDate),
            bettingOpensAt:
              race === undefined
                ? Date.parse(`${raceDate}T${schedule.recommendedLockTime}+09:00`)
                : moveTimestampToJstDate(race.bettingOpensAt, raceDate),
            bettingClosesAt:
              race === undefined
                ? Date.parse(`${raceDate}T${schedule.bettingCloseTime}+09:00`)
                : moveTimestampToJstDate(race.bettingClosesAt, raceDate),
            viewerOpensAt:
              race === undefined
                ? Date.parse(`${raceDate}T${schedule.viewerOpenTime}+09:00`)
                : moveTimestampToJstDate(race.viewerOpensAt, raceDate),
            entries,
          }),
        },
      );
      formElement.reset();
      setSelectedHorseIds(Array.from({ length: 8 }, () => ''));
      setError('');
      await onSaved();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : '保存できません。入力内容を確認してください。',
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  const activeHorseCount = horses.filter((horse) => horse.status !== 'retired').length;
  function autoAssignHorses(): void {
    const availableHorseIds = shuffled(horses.filter((horse) => horse.status !== 'retired'))
      .slice(0, 8)
      .map((horse) => horse.id);
    if (availableHorseIds.length < 8) {
      setError('レース作成には、引退していない馬が8頭必要です。');
      return;
    }
    setSelectedHorseIds(availableHorseIds);
    setError('');
  }

  const distanceCandidate = Number(race?.distanceM ?? 1_200);
  const currentDistance = Number.isInteger(distanceCandidate) ? distanceCandidate : 1_200;
  const distanceOptions = Array.from(
    new Set([
      ...DISTANCE_OPTIONS,
      ...(race !== undefined && Number.isInteger(currentDistance) ? [currentDistance] : []),
    ]),
  ).sort((left, right) => left - right);
  return (
    <AdminDialog
      title={race === undefined ? 'レースを作成' : '下書きを編集'}
      onCancel={onCancel}
      returnFocusRef={returnFocusRef}
      canCancel={!isSubmitting}
    >
      <form
        className="terminal-form"
        aria-busy={isSubmitting}
        onSubmit={(event) => void submit(event)}
      >
        <div className="form-row">
          <label>
            開催日
            <input name="raceDate" type="date" required defaultValue={race?.raceDate} />
          </label>
          <label>
            レース名
            <input name="name" required maxLength={100} defaultValue={race?.name} />
          </label>
          <label>
            種別
            <select name="kind" defaultValue={race?.kind ?? ''}>
              <option value="">曜日から自動決定</option>
              <option value="regular">通常</option>
              <option value="midweek">平日</option>
              <option value="saturday_night">土曜夜</option>
            </select>
          </label>
          <label>
            距離
            <select name="distanceM" defaultValue={String(currentDistance)} required>
              {distanceOptions.map((distance) => (
                <option key={distance} value={distance}>
                  {String(distance)}m
                </option>
              ))}
            </select>
          </label>
          <label>
            コース
            <select name="surface" defaultValue={race?.surface ?? 'turf'}>
              <option value="turf">芝</option>
              <option value="dirt">ダート</option>
            </select>
          </label>
        </div>
        <fieldset className="entry-selects">
          <legend>
            出走馬
            <button
              type="button"
              className="text-button"
              onClick={autoAssignHorses}
              disabled={activeHorseCount < 8 || isSubmitting}
            >
              自動決定
            </button>
          </legend>
          {Array.from({ length: 8 }, (_, index) => {
            const selectedHorseId = selectedHorseIds[index] ?? '';
            return (
              <label key={index}>
                {String(index + 1)}番
                <select
                  name={`horse-${String(index + 1)}`}
                  required
                  value={selectedHorseId}
                  onChange={(event) => {
                    const nextHorseId = event.currentTarget.value;
                    setSelectedHorseIds((current) =>
                      current.map((horseId, horseIndex) =>
                        horseIndex === index ? nextHorseId : horseId,
                      ),
                    );
                    setError('');
                  }}
                >
                  <option value="" disabled>
                    馬を選択
                  </option>
                  {horses
                    .filter((horse) => horse.status !== 'retired' || horse.id === selectedHorseId)
                    .filter(
                      (horse) =>
                        !selectedHorseIds.some(
                          (selectedHorseIdAtOtherPosition, selectedIndex) =>
                            selectedIndex !== index && selectedHorseIdAtOtherPosition === horse.id,
                        ),
                    )
                    .map((horse) => (
                      <option key={horse.id} value={horse.id}>
                        {horse.status === 'retired'
                          ? `${horse.name}（引退・交換してください）`
                          : horse.name}
                      </option>
                    ))}
                </select>
              </label>
            );
          })}
        </fieldset>
        {activeHorseCount < 8 ? (
          <p className="field-error">レース作成には、引退していない馬が8頭必要です。</p>
        ) : null}
        {error === '' ? null : (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
        <div className="form-actions">
          <button type="submit" disabled={activeHorseCount < 8 || isSubmitting}>
            {isSubmitting ? '保存中…' : race === undefined ? '下書きを保存' : '変更を保存'}
          </button>
          <button
            type="button"
            className="button-secondary"
            onClick={onCancel}
            disabled={isSubmitting}
          >
            キャンセル
          </button>
        </div>
      </form>
    </AdminDialog>
  );
}
