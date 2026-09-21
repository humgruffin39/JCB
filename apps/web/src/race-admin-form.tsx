import { useId, useState, type FormEvent } from 'react';
import { AdminDateField } from './admin-date-field.js';
import { AdminSelect } from './admin-select.js';
import { AdminDialog } from './admin-dialog.js';
import { apiRequest } from './api.js';
import {
  DISTANCE_OPTIONS,
  type AdminRace,
  type HorseOption,
  type ScheduleSettings,
} from './race-admin-model.js';
import {
  defaultVenueThemeForKind,
  entriesFor,
  moveTimestampToJstDate,
  raceKindForDate,
  selectBalancedField,
} from './race-admin-utils.js';
import { useSubmitLock } from './use-submit-lock.js';

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
  const entryGroupId = useId();
  const formId = useId();
  const [error, setError] = useState('');
  const {
    isLocked: isSubmitting,
    lock: lockSubmission,
    unlock: unlockSubmission,
  } = useSubmitLock();
  const selectedEntries = entriesFor(race);
  const selectedEntriesByNumber = new Map(
    selectedEntries.map((entry) => [entry.horseNumber, entry] as const),
  );
  const [selectedHorseIds, setSelectedHorseIds] = useState<readonly string[]>(() =>
    Array.from({ length: 8 }, (_, index) => selectedEntriesByNumber.get(index + 1)?.horseId ?? ''),
  );

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
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
    if (!lockSubmission()) return;
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
            ...(String(form.get('venueTheme')) === ''
              ? race === undefined
                ? {}
                : { venueTheme: defaultVenueThemeForKind(String(form.get('kind')), raceDate) }
              : { venueTheme: String(form.get('venueTheme')) }),
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
      unlockSubmission();
    }
  }

  const activeHorseCount = horses.filter((horse) => horse.status !== 'retired').length;
  function autoAssignHorses(): void {
    const availableHorseIds = selectBalancedField(
      horses.filter((horse) => horse.status !== 'retired'),
      8,
      shuffled,
    ).map((horse) => horse.id);
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
      footer={
        <div className="form-actions">
          <button type="submit" form={formId} disabled={activeHorseCount < 8 || isSubmitting}>
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
      }
    >
      <form
        id={formId}
        className="terminal-form"
        aria-busy={isSubmitting}
        onSubmit={(event) => void submit(event)}
      >
        <div className="form-row">
          <label>
            開催日
            <AdminDateField name="raceDate" required defaultValue={race?.raceDate ?? ''} />
          </label>
          <label>
            レース名
            <input name="name" required maxLength={100} defaultValue={race?.name} />
          </label>
          <AdminSelect
            label="種別"
            name="kind"
            defaultValue={race?.kind ?? ''}
            options={[
              { value: '', label: '曜日から自動決定' },
              { value: 'regular', label: '通常' },
              { value: 'midweek', label: '平日' },
              { value: 'saturday_night', label: '土曜夜' },
            ]}
          />
          <AdminSelect
            label="距離"
            name="distanceM"
            defaultValue={String(currentDistance)}
            options={distanceOptions.map((distance) => ({
              value: String(distance),
              label: `${String(distance)}m`,
            }))}
          />
          <AdminSelect
            label="コース"
            name="surface"
            defaultValue={race?.surface ?? 'turf'}
            options={[
              { value: 'turf', label: '芝' },
              { value: 'dirt', label: 'ダート' },
            ]}
          />
          <AdminSelect
            label="会場"
            name="venueTheme"
            defaultValue={race?.venueTheme ?? ''}
            options={[
              { value: '', label: '種別から自動決定' },
              { value: 'standard', label: '昼' },
              { value: 'night', label: 'ナイター' },
            ]}
          />
        </div>
        {/*
          Not a fieldset: a legend is drawn across its box's top edge, which
          left the label sitting half on the sunken surface and half off it.
          A group with its own labelled header keeps the label inside the box.
        */}
        <div className="entry-selects" role="group" aria-labelledby={entryGroupId}>
          <div className="entry-selects__header">
            <span id={entryGroupId}>出走馬</span>
            <button
              type="button"
              className="text-button entry-selects__auto"
              onClick={autoAssignHorses}
              disabled={activeHorseCount < 8 || isSubmitting}
            >
              自動選択
            </button>
          </div>
          <div className="entry-selects__grid">
            {Array.from({ length: 8 }, (_, index) => {
              const selectedHorseId = selectedHorseIds[index] ?? '';
              return (
                <AdminSelect
                  key={index}
                  label={`${String(index + 1)}番`}
                  name={`horse-${String(index + 1)}`}
                  placeholder="馬を選択"
                  value={selectedHorseId}
                  onChange={(nextHorseId) => {
                    setSelectedHorseIds((current) =>
                      current.map((horseId, horseIndex) =>
                        horseIndex === index ? nextHorseId : horseId,
                      ),
                    );
                    setError('');
                  }}
                  options={horses
                    .filter((horse) => horse.status !== 'retired' || horse.id === selectedHorseId)
                    .filter(
                      (horse) =>
                        !selectedHorseIds.some(
                          (selectedHorseIdAtOtherPosition, selectedIndex) =>
                            selectedIndex !== index && selectedHorseIdAtOtherPosition === horse.id,
                        ),
                    )
                    .map((horse) => ({
                      value: horse.id,
                      label:
                        horse.status === 'retired'
                          ? `${horse.name}（引退・交換してください）`
                          : horse.name,
                    }))}
                />
              );
            })}
          </div>
        </div>
        {/* One message at a time. The shortage is the reason the form cannot
            be submitted at all, so it outranks anything a submit would say. */}
        {activeHorseCount < 8 ? (
          <p className="field-error">レース作成には、引退していない馬が8頭必要です。</p>
        ) : error === '' ? null : (
          <p className="field-error" role="alert">
            {error}
          </p>
        )}
      </form>
    </AdminDialog>
  );
}
