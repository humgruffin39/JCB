import { expect, test } from '@playwright/test';

const race = {
  id: 'race-demo',
  raceDate: '2026-08-03',
  name: 'ジョサン記念',
  kind: 'regular',
  status: 'betting_open',
  version: 1,
  distanceM: 1200,
  surface: 'turf',
  scheduledAt: Date.now() + 60 * 60 * 1000,
  bettingClosesAt: Date.now() + 59 * 60 * 1000,
  viewerOpensAt: Date.now() + 55 * 60 * 1000,
  entries: Array.from({ length: 8 }, (_, index) => ({
    horseNumber: index + 1,
    horseId: `horse-${String(index + 1)}`,
    name: `サンプルホース${String(index + 1)}`,
    runningStyle: index % 2 === 0 ? 'front_runner' : 'closer',
    coatColor: (['black', 'chestnut', 'gray', 'cream'] as const)[index % 4]!,
    condition: 'normal',
    baseWinOdds: `${String(index + 2)}.0`,
    currentWinOdds: `${String(index + 2)}.4`,
  })),
  trifectaPoolTotal: '15000',
  carryover: '2500',
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const result = path.endsWith('/my-bets')
      ? []
      : path.endsWith('/time')
        ? { epochMilliseconds: Date.now() }
        : race;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ apiVersion: 'v1', result }),
    });
  });
});

test('renders the full-screen race broadcast at 360px without horizontal overflow', async ({
  page,
}) => {
  await page.goto('/races/race-demo');
  await expect(page.getByRole('region', { name: 'ジョサン記念 レース観戦' })).toBeVisible();
  await expect(page.getByText(/後に発走/)).toBeVisible();
  await expect(page.getByRole('button', { name: /馬券.*購入/ })).toHaveCount(0);
  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
});

test('keeps controls keyboard reachable and honors reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/races/race-demo');
  await page.locator('.skip-link').focus();
  await expect(page.locator('.skip-link')).toBeFocused();
  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
});
