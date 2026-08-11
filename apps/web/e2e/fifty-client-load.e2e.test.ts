import { expect, test } from '@playwright/test';

test('serves the read-only terminal to 50 concurrent clients', async ({ browser }, testInfo) => {
  test.setTimeout(90_000);
  test.skip(
    testInfo.project.name !== 'desktop',
    'The 50-client load is measured once on desktop Chromium.',
  );
  const context = await browser.newContext();
  const pages = await Promise.all(
    Array.from({ length: 50 }, async () => {
      const page = await context.newPage();
      await page.route('**/api/v1/**', async (route) => {
        const path = new URL(route.request().url()).pathname;
        const result = path.endsWith('/my-bets')
          ? []
          : path.endsWith('/time')
            ? { epochMilliseconds: Date.now() }
            : path.endsWith('/settings/public')
              ? {
                  recommendedLockTime: '18:00:00',
                  viewerOpenTime: '21:55:00',
                  bettingCloseTime: '21:59:30',
                  startTime: '22:00:00',
                  webOddsPollMilliseconds: 15_000,
                  visualEffectStrength: 0.6,
                  soundVolume: 0.5,
                }
              : raceFixture();
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ apiVersion: 'v1', result }),
        });
      });
      return page;
    }),
  );

  const started = performance.now();
  await Promise.all(
    pages.map((page) => page.goto('/races/load-test', { waitUntil: 'domcontentloaded' })),
  );
  const remainingPerformanceBudgetMs = Math.max(1, 45_000 - (performance.now() - started));
  await Promise.all(
    pages.map((page) =>
      expect(page.getByRole('region', { name: '50クライアント負荷試験 レース観戦' })).toBeVisible({
        timeout: remainingPerformanceBudgetMs,
      }),
    ),
  );
  const elapsed = performance.now() - started;

  expect(elapsed).toBeLessThan(45_000);
  await context.close();
});

function raceFixture() {
  const scheduledAt = Date.now() + 60 * 60 * 1_000;
  return {
    id: 'load-test',
    raceDate: '2026-08-03',
    name: '50クライアント負荷試験',
    kind: 'regular',
    status: 'betting_open',
    version: 1,
    distanceM: 1_600,
    surface: 'turf',
    scheduledAt,
    bettingClosesAt: scheduledAt - 30_000,
    viewerOpensAt: scheduledAt - 5 * 60 * 1_000,
    entries: Array.from({ length: 8 }, (_, index) => ({
      horseNumber: index + 1,
      horseId: `horse-${String(index + 1)}`,
      name: `負荷試験馬${String(index + 1)}`,
      runningStyle: index % 2 === 0 ? 'front_runner' : 'closer',
      coatColor: (['black', 'chestnut', 'gray', 'cream'] as const)[index % 4]!,
      condition: 'normal',
      baseWinOdds: '8.0',
      currentWinOdds: '8.0',
    })),
    trifectaPoolTotal: '15000',
    carryover: '0',
  };
}
