export interface SettingsHistoryEntry {
  readonly id: string;
  readonly updatedByUserId: string | null;
  readonly updatedAt: string;
}

export function SettingsHistory({
  history,
}: {
  readonly history: readonly SettingsHistoryEntry[];
}) {
  return (
    <details>
      <summary>変更履歴（{String(history.length)}件）</summary>
      {history.length === 0 ? (
        <p className="empty-copy">変更履歴はまだありません。</p>
      ) : (
        <ol className="audit-list">
          {history.slice(0, 20).map((entry) => (
            <li key={entry.id}>
              <time>{formatTimestamp(entry.updatedAt)}</time>
              <strong>運用設定を更新</strong>
              <small>{entry.updatedByUserId ?? 'システム'}</small>
            </li>
          ))}
        </ol>
      )}
    </details>
  );
}

function formatTimestamp(value: string): string {
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo',
    dateStyle: 'short',
    timeStyle: 'medium',
  }).format(new Date(Number(value)));
}
