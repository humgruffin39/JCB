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
}));

const race = {
  id: 'race-1',
  raceDate: '2026-08-11',
  name: 'テスト記念',
  status: 'draft',
  version: 1,
  kind: 'regular',
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
    if (path.endsWith('/auth/csrf')) {
      result = { csrfToken: 'test-csrf-token' };
    } else if (path.endsWith('/admin/health')) {
      result = { databaseReadWrite: true };
    } else if (path.endsWith('/admin/races')) {
      raceReads += 1;
      result = [{ ...race, status: raceReads > 1 ? 'locked' : 'draft' }];
    } else if (path.endsWith('/admin/horses')) {
      result = horses;
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
  await expect(page.locator('.condition-readout')).toContainText('1番 絶好調');
  await expect(page.locator('.condition-readout')).not.toContainText('excellent');

  await expect(page.getByRole('combobox', { name: '距離' })).toHaveValue('1200');
  await expect(
    page.getByRole('combobox', { name: '距離' }).locator('option[value="1200"]'),
  ).toHaveText('1200m');

  await page.getByRole('button', { name: 'テスト記念の下書きを編集' }).click();
  await expect(page.getByRole('combobox', { name: '1番' })).toHaveValue('horse-1');
  await expect(page.getByRole('combobox', { name: '8番' })).toHaveValue('horse-8');
  await expect(
    page.getByRole('combobox', { name: '2番' }).locator('option[value="horse-1"]'),
  ).toHaveCount(0);

  await expect(page.getByText('確定済み', { exact: true })).toBeVisible({ timeout: 8_000 });
});
