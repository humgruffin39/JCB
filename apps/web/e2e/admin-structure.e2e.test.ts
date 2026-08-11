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

test('separates currency and system operations into focused sections', async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let result: unknown = [];
    if (path.endsWith('/settings/public')) {
      result = publicSettings;
    } else if (path.endsWith('/admin/health')) {
      result = {
        databaseReadWrite: true,
        ledgerProjectionValid: true,
        memoryStatus: 'nominal',
        schedulerStatus: 'nominal',
        r2AccessStatus: 'nominal',
        discordGatewayConnected: true,
        deadJobs: 0,
      };
    } else if (path.endsWith('/admin/economy')) {
      result = {
        accounts: [],
        bets: [],
        settlements: [],
        carryover: null,
        seedPositions: [],
        relief: [],
      };
    } else if (path.endsWith('/admin/ledger')) {
      result = [];
    } else if (path.endsWith('/admin/system-objects')) {
      result = { discordMessages: [], timelineObjects: [] };
    } else if (path.endsWith('/admin/settings')) {
      result = { gameSettings: {}, history: [] };
    } else if (path.endsWith('/admin/administrators')) {
      result = [];
    }
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ apiVersion: 'v1', result }),
    });
  });

  await page.goto('/admin');
  await page.getByRole('tab', { name: '通貨管理' }).click();
  await expect(page.getByRole('heading', { name: '口座残高' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '馬券履歴' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '概要' })).toHaveAttribute('aria-selected', 'true');

  await page.getByRole('tab', { name: '馬券' }).click();
  await expect(page.getByRole('heading', { name: '馬券履歴' })).toBeVisible();
  await expect(page.getByRole('heading', { name: '口座残高' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'システム' }).click();
  await expect(page.getByRole('heading', { name: 'システム状態' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'ジョブキュー' })).toHaveCount(0);
  await page.getByRole('tab', { name: '自動処理' }).click();
  await expect(page.getByRole('heading', { name: 'ジョブキュー' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'システム状態' })).toHaveCount(0);
});
