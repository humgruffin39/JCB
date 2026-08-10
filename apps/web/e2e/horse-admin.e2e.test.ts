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

test.beforeEach(async ({ page }) => {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const result = path.endsWith('/settings/public')
      ? publicSettings
      : path.endsWith('/admin/health')
        ? { databaseReadWrite: true }
        : [];
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ apiVersion: 'v1', result }),
    });
  });
});

test('edits all abilities with accessible sliders and uses turf or dirt courses', async ({
  page,
}) => {
  await page.goto('/admin');
  await expect(page.getByRole('heading', { name: '競馬BOT 管理' })).toBeVisible();
  await expect(page.getByText('SECURE LINK')).toHaveCount(0);
  await expect(page.getByText('RACE CONTROL TERMINAL')).toHaveCount(0);
  await expect(page.getByText('レース、出走馬、通貨、システム設定を管理します。')).toHaveCount(0);
  await expect(page.locator('.app-shell--admin')).toHaveCSS('background-color', 'rgb(8, 8, 8)');
  expect((await page.locator('main').boundingBox())?.width).toBeLessThanOrEqual(1_152);

  const course = page.getByLabel('コース');
  await expect(course).toHaveValue('turf');
  await expect(course.locator('option')).toHaveText(['芝', 'ダート']);

  await page.getByRole('button', { name: '馬管理' }).click();
  await expect(page.getByRole('group', { name: '基本能力' })).toBeVisible();
  await expect(page.getByRole('group', { name: '適性' })).toBeVisible();
  await expect(page.getByText('ノビ', { exact: true })).toBeVisible();
  await expect(page.getByText('末脚', { exact: true })).toHaveCount(0);
  await expect(page.getByText('各能力を0〜100で設定します。')).toHaveCount(0);
  await expect(
    page.getByText('中央は補正なし。片側へ寄せると、反対側では同じ分だけ不利になります。'),
  ).toHaveCount(0);
  await expect(page.getByText('中立', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('毛色')).toHaveValue('chestnut');
  await expect(page.getByLabel('毛色').locator('option')).toHaveText([
    '黒',
    '栗毛',
    'グレー',
    'クリーム',
  ]);
  await expect(page.getByRole('slider')).toHaveCount(8);
  await expect(page.locator('.preference-slider__scale')).toHaveCount(0);

  const distance = page.getByRole('slider', { name: '距離' });
  await distance.focus();
  await distance.press('ArrowRight');
  await expect(distance).toHaveValue('1');
  await expect(page.locator('output').filter({ hasText: /^1$/ })).toBeVisible();

  const preference = page.getByRole('slider', { name: 'コース' });
  await preference.press('Home');
  await expect(preference).toHaveValue('-100');
  await expect(page.locator('output').filter({ hasText: /^-100$/ })).toBeVisible();
  await preference.press('End');
  await expect(preference).toHaveValue('100');
  await expect(page.locator('output').filter({ hasText: /^100$/ })).toBeVisible();

  const outputFont = await page
    .locator('.ability-slider output')
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(outputFont).toContain('Noto Sans JP Variable');
  await expect(page.locator('.preference-slider input').first()).toHaveCSS(
    'accent-color',
    'rgb(240, 240, 240)',
  );
  const coloredAdminValues = await page.locator('.app-shell--admin').evaluate((root) => {
    const elements = [root, ...root.querySelectorAll('*')];
    const properties = [
      'color',
      'backgroundColor',
      'borderTopColor',
      'borderRightColor',
      'borderBottomColor',
      'borderLeftColor',
      'outlineColor',
      'accentColor',
    ] as const;
    return elements.flatMap((element) => {
      const style = getComputedStyle(element);
      return properties
        .map((property) => style[property])
        .filter((value) => {
          const channels = /rgba?\((\d+),?\s+(\d+),?\s+(\d+)/.exec(value);
          return channels !== null && (channels[1] !== channels[2] || channels[2] !== channels[3]);
        });
    });
  });
  expect(coloredAdminValues).toEqual([]);

  expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);

  const dimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);

  await page.setViewportSize({ width: 320, height: 900 });
  const narrowDimensions = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(narrowDimensions.scrollWidth).toBeLessThanOrEqual(narrowDimensions.clientWidth);
});
