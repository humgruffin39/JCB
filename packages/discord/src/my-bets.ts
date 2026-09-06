import { POOL_TYPE_DEFINITIONS, type PoolType } from '@jcb/domain';
import { horseSelectionEmojis } from './horse-number-emoji.js';

const MESSAGE_LIMIT = 1_900;
const GROUP_THRESHOLD = 4;

export interface MyBetLine {
  readonly poolType: PoolType;
  readonly selectionCode: string;
  readonly stake: string;
  readonly status: string;
}

const BET_STATUS_LABELS: Readonly<Record<string, string>> = {
  open: '受付中',
  won: '的中',
  lost: '外れ',
  refunded: '返金済み',
};

export function betStatusLabel(status: string): string {
  return BET_STATUS_LABELS[status] ?? '状態不明';
}

/**
 * A formation can be dozens of tickets, which would blow past Discord's message
 * limit one line at a time. Points that share a pool, a stake and an outcome say
 * nothing individually, so they collapse into a count; the winning ticket keeps
 * its own line because that is the one worth reading.
 */
export function renderMyBets(bets: readonly MyBetLine[]): string {
  if (bets.length === 0) return 'このレースで購入済みの馬券はありません。';
  const lines: string[] = [];
  for (const group of groupBets(bets)) {
    const label = POOL_TYPE_DEFINITIONS[group.poolType].label;
    const status = betStatusLabel(group.status);
    lines.push(
      group.members.length < GROUP_THRESHOLD
        ? group.members
            .map(
              (bet) =>
                `${label} ${horseSelectionEmojis(bet.selectionCode)} / ${bet.stake} CP / 状態: ${status}`,
            )
            .join('\n')
        : `${label} ${String(group.members.length)}点 / 各${group.stake} CP / 計${(
            BigInt(group.stake) * BigInt(group.members.length)
          ).toLocaleString('ja-JP')} CP / 状態: ${status}`,
    );
  }
  return fit(lines);
}

function groupBets(bets: readonly MyBetLine[]): readonly {
  readonly poolType: PoolType;
  readonly stake: string;
  readonly status: string;
  readonly members: readonly MyBetLine[];
}[] {
  const groups = new Map<
    string,
    { poolType: PoolType; stake: string; status: string; members: MyBetLine[] }
  >();
  for (const bet of bets) {
    const key = `${bet.poolType}:${bet.stake}:${bet.status}`;
    const group = groups.get(key);
    if (group === undefined) {
      groups.set(key, {
        poolType: bet.poolType,
        stake: bet.stake,
        status: bet.status,
        members: [bet],
      });
    } else {
      group.members.push(bet);
    }
  }
  return [...groups.values()];
}

function fit(lines: readonly string[]): string {
  for (let shown = lines.length; shown > 0; shown -= 1) {
    const hidden = lines.length - shown;
    const message = [
      ...lines.slice(0, shown),
      ...(hidden === 0 ? [] : [`ほか${String(hidden)}件`]),
    ].join('\n');
    if (message.length <= MESSAGE_LIMIT) return message;
  }
  return `購入済み馬券は${String(lines.length)}件あります。`;
}
