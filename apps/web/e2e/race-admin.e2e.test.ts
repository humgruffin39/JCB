import { expect, test } from '@playwright/test';

const publicSettings = {
  recommendedLockTime: '18:00:00',
  viewerOpenTime: '21:55:00',
  bettingCloseTime: '21:59:30',
  startTime: '22:00:00',
  webOddsPollMilliseconds: 15_000,
  visualEffectStrength: 0.7,
  soundVolume: 0.5,
};

const horses = Array.from({ length: 8 }, (_, index) => ({
  id: `horse-${String(index + 1)}`,
  name: `テスト馬${String(index + 1)}`,
  status: 'active',
  runningStyle: index % 2 === 0 ? 'front_runner' : 'closer',
}));

const race = {
  id: 'race-1',
  raceDate: '2026-08-11',
  name: 'テスト記念',
  status: 'draft',
  version: 1,
  kind: 'regular',
  venueTheme: 'standard',
  distanceM: '1200',
  surface: 'turf',
  scheduledAt: '1786453200000',
  bettingOpensAt: '1786438800000',
  bettingClosesAt: '1786453170000',
  viewerOpensAt: '1786452900000',
  entriesJson: JSON.stringify(
    Array.from({ length: 8 }, (_, index) => ({
      horseId: `horse-${String(index + 1)}`,
      horseNumber: index + 1,
      condition: index === 0 ? 'excellent' : index === 1 ? 'normal' : undefined,
    })).reverse(),
  ),
  officialSimulationStatus: null,
  oddsSimulationStatus: null,
  oddsSelectionCount: '0',
  minimumBaseOdds: null,
  maximumBaseOdds: null,
  seedLiquidity: '0',
  seedLiquidityDiagnosticsJson: null,
  timelineObjectKey: null,
};

test('keeps race operations Japanese, filters selected horses, and refreshes status', async ({
  page,
}) => {
  let raceReads = 0;
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown;
    if (path.endsWith('/auth/csrf') || path.endsWith('/auth/admin/csrf')) {
      result = { csrfToken: 'test-csrf-token' };
    } else if (path.endsWith('/admin/health')) {
      result = { databaseReadWrite: true };
    } else if (path.endsWith('/admin/races')) {
      raceReads += 1;
      result = [{ ...race, status: raceReads > 1 ? 'locked' : 'draft' }];
    } else if (path.endsWith('/admin/horses')) {
      result = horses;
    } else if (path.endsWith('/admin/settings')) {
      result = { gameSettings: publicSettings, history: [] };
    } else if (path.endsWith('/settings/public')) {
      result = publicSettings;
    } else {
      result = [];
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ apiVersion: 'v1', result }),
    });
  });

  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '開催一覧' })).toBeVisible();
  await expect(page.getByText('下書き', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: 'レースを作成' }).click();
  const createDialog = page.getByRole('dialog', { name: 'レースを作成' });
  await expect(createDialog).toBeVisible();
  await expect(createDialog.getByLabel('開催日')).toBeFocused();
  const entries = createDialog.getByRole('group', { name: '出走馬' });
  await expect(entries).toBeVisible();
  await createDialog.getByRole('button', { name: '自動選択' }).click();
  // The dropdown carries its value to the form in a hidden input, the way a
  // native one carries its own.
  const automaticallyAssignedHorseIds = await createDialog
    .locator('input[name^="horse-"]')
    .evaluateAll((inputs) =>
      inputs.map((input) => (input instanceof HTMLInputElement ? input.value : '')),
    );
  expect(new Set(automaticallyAssignedHorseIds).size).toBe(8);
  expect(automaticallyAssignedHorseIds.sort()).toEqual(horses.map((horse) => horse.id).sort());
  const distance = createDialog.getByRole('combobox', { name: '距離' });
  await expect(distance).toHaveText('1200m');
  await expect(createDialog.locator('input[name="distanceM"]')).toHaveValue('1200');
  await distance.click();
  const distances = createDialog.getByRole('listbox');
  await expect(distances.getByRole('option')).toHaveCount(5);
  await expect(distances.getByRole('option').first()).toHaveText('1200m');
  await page.keyboard.press('Escape');
  await createDialog.getByRole('button', { name: 'キャンセル' }).click();
  await expect(createDialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'レースを作成' })).toBeFocused();

  await page.getByRole('button', { name: 'テスト記念の下書きを編集' }).click();
  const editDialog = page.getByRole('dialog', { name: '下書きを編集' });
  await expect(editDialog).toBeVisible();
  await expect(editDialog.getByRole('combobox', { name: '1番' })).toHaveText('テスト馬1');
  await expect(editDialog.getByRole('combobox', { name: '8番' })).toHaveText('テスト馬8');
  // A horse taken by another position is not offered again.
  await editDialog.getByRole('combobox', { name: '2番' }).click();
  await expect(
    editDialog.getByRole('listbox').getByRole('option', { name: 'テスト馬1' }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');

  await expect(page.getByText('確定済み', { exact: true })).toBeVisible({ timeout: 8_000 });
});
