import { conditionLabel } from './admin-labels.js';
import { AdminDialog } from './admin-dialog.js';
import type { Horse, HorsePerformance } from './horse-admin-model.js';
import { formatDateKeyForDisplay } from './race-admin-utils.js';

export function HorsePerformanceDialog({
  horse,
  record,
  onClose,
}: {
  readonly horse: Horse;
  readonly record: HorsePerformance;
  readonly onClose: () => void;
}) {
  return (
    <AdminDialog title={`${horse.name}の戦績・出走履歴`} onCancel={onClose}>
      <p>
        3着以内 {String(record.topThreeFinishes)}回
        {record.starts === 0
          ? '。確定済みの出走履歴はありません。'
          : ` / 勝率 ${((record.wins / record.starts) * 100).toFixed(1)}%`}
      </p>
      <div className="data-table-wrap">
        <table className="data-table">
          <caption className="visually-hidden">{horse.name}の出走履歴</caption>
          <thead>
            <tr>
              <th scope="col">開催日</th>
              <th scope="col">レース</th>
              <th scope="col">馬番</th>
              <th scope="col">調子</th>
              <th scope="col">着順</th>
              <th scope="col">タイム</th>
            </tr>
          </thead>
          <tbody>
            {record.history.map((row) => (
              <tr key={row.raceId}>
                <td>{formatDateKeyForDisplay(row.raceDate)}</td>
                <td>
                  {row.raceName} / {row.distanceM}m / {surfaceLabel(row.surface)}
                </td>
                <td>{row.horseNumber}</td>
                <td>{conditionLabel(row.condition)}</td>
                <td>{row.finishPosition ?? '未確定'}</td>
                <td>
                  {row.finishTimeMs === null
                    ? '—'
                    : `${(Number(row.finishTimeMs) / 1000).toFixed(3)}秒`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" className="button-secondary" onClick={onClose}>
        閉じる
      </button>
    </AdminDialog>
  );
}

function surfaceLabel(surface: HorsePerformance['history'][number]['surface']): string {
  return surface === 'turf' ? '芝' : 'ダート';
}
