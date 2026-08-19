import type { SqliteViewerStore } from '@jcb/database';

export function resolveFinishOrder(
  viewerStore: SqliteViewerStore,
  raceId: string,
  status: string,
): readonly { readonly horseNumber: number; readonly position: number }[] | undefined {
  if (status !== 'settling' && status !== 'settled') return undefined;
  try {
    return viewerStore.getResult(raceId).finishOrder;
  } catch {
    return undefined;
  }
}
