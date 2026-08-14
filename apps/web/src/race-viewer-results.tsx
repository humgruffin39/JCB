import { type CSSProperties } from 'react';
import { PodiumHorsePreview } from './podium-horse-preview.js';
import { SADDLECLOTH_COLORS } from './race-horse-model.js';
import type { FinishOrder } from './race-viewer-selectors.js';
import type { getRace } from './api.js';
import { PublicState } from './public-state.js';

type RaceDetail = Awaited<ReturnType<typeof getRace>>;
export interface Bet {
  readonly id: string;
  readonly poolType: 'win' | 'trifecta';
  readonly selectionCode: string;
  readonly stake: string;
  readonly status: 'open' | 'won' | 'lost' | 'refunded';
  readonly payout: string;
  readonly createdAt: number;
}

export function PhotoFinish() {
  return (
    <div className="photo-finish" role="status" aria-label="写真判定" aria-live="assertive">
      <div className="photo-flash" />
    </div>
  );
}

export function FinishSnapshot({ snapshot }: { readonly snapshot: string }) {
  return (
    <img className="finish-snapshot" src={snapshot} alt="1位がゴールした瞬間のフィニッシュ写真" />
  );
}

export function ResultUnavailable({ message }: { readonly message: string | undefined }) {
  const isLoading = message === undefined;
  return (
    <PublicState
      status={isLoading ? 'loading' : 'error'}
      heading={isLoading ? '公式結果を確認しています' : '公式結果を表示できません'}
      {...(message === undefined ? {} : { message })}
    />
  );
}

export interface ResultsScreenProps {
  readonly entries: RaceDetail['entries'];
  readonly finishOrder: readonly FinishOrder[];
  readonly bets: readonly Bet[];
  readonly betsLoading: boolean;
  readonly betsError: string | undefined;
  readonly onReplay: () => void;
}

export function ResultsScreen({
  entries,
  finishOrder,
  bets,
  betsLoading,
  betsError,
  onReplay,
}: ResultsScreenProps) {
  const topThree = finishOrder.slice(0, 3);
  return (
    <div className="results-screen" role="region" aria-label="確定結果">
      <ol className="podium">
        {topThree.map((finish) => {
          const entry = entries.find((value) => value.horseNumber === finish.horseNumber);
          const saddlecloth = getSaddleclothStyle(finish.horseNumber);
          return (
            <li
              className={`podium-card podium-card--${String(finish.position)}`}
              key={finish.horseNumber}
            >
              <span className="podium-place">{String(finish.position)}着</span>
              <PodiumHorsePreview
                horseNumber={finish.horseNumber}
                coatColor={entry?.coatColor ?? 'chestnut'}
              />
              <div className="podium-name">
                <span className="podium-horse-number" style={saddlecloth}>
                  {String(finish.horseNumber)}
                </span>
                <strong>{entry?.name ?? `${String(finish.horseNumber)}番`}</strong>
              </div>
            </li>
          );
        })}
      </ol>
      <section className="payout-board" aria-labelledby="payout-heading">
        <div>
          <h3 id="payout-heading">払戻</h3>
        </div>
        {betsLoading ? (
          <p>購入情報を確認しています。</p>
        ) : betsError !== undefined ? (
          <p>{betsError}</p>
        ) : bets.length === 0 ? (
          <p>購入した馬券はありません</p>
        ) : (
          <ul>
            {bets.map((bet) => (
              <li key={bet.id}>
                <div className="ticket-selection">
                  <span className="ticket-type">{bet.poolType === 'win' ? '単勝' : '三連単'}</span>
                  <span
                    className="ticket-horses"
                    aria-label={`${bet.selectionCode.replaceAll('-', '番、')}番`}
                  >
                    {bet.selectionCode.split('-').map((horseNumber) => (
                      <span
                        className="ticket-horse-number"
                        style={getSaddleclothStyle(Number(horseNumber))}
                        key={horseNumber}
                        aria-hidden="true"
                      >
                        {horseNumber}
                      </span>
                    ))}
                  </span>
                </div>
                <div className="ticket-payout">
                  <strong>{BigInt(bet.payout) > 0n ? formatRupees(bet.payout) : 'はずれ'}</strong>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
      <button className="replay-button" type="button" onClick={onReplay}>
        もう一度見る
      </button>
    </div>
  );
}

export function getSaddleclothStyle(horseNumber: number): CSSProperties {
  const colors = SADDLECLOTH_COLORS[horseNumber - 1] ?? SADDLECLOTH_COLORS[0];
  return {
    '--horse-number-fill': colors.background,
    '--horse-number-text': colors.foreground,
    '--horse-number-border':
      horseNumber === 1 || horseNumber === 5 ? '#111111' : 'rgb(255 255 255 / 48%)',
  } as CSSProperties;
}

export function formatRupees(value: string): string {
  return `${BigInt(value).toLocaleString('ja-JP')} R`;
}
