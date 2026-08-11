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
    const result = path.endsWith('/auth/csrf')
      ? { csrfToken: 'test-csrf-token' }
      : path.endsWith('/settings/public')
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

test('opens compact forms and edits abilities with accessible number inputs', async ({ page }) => {
  await page.goto('/admin');
  await expect(page.locator('.app-shell--admin .masthead')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: '運用コンソール' })).toHaveCount(0);
  await expect(page.getByText('SECURE LINK')).toHaveCount(0);
  await expect(page.getByText('RACE CONTROL TERMINAL')).toHaveCount(0);
  await expect(page.getByText('レース、出走馬、通貨、システム設定を管理します。')).toHaveCount(0);
  await expect(page.locator('.app-shell--admin')).toHaveCSS('background-color', 'rgb(8, 8, 8)');
  expect((await page.locator('main').boundingBox())?.width).toBeLessThanOrEqual(1_152);

  await page.getByRole('button', { name: 'レースを作成' }).click();
  const raceDialog = page.getByRole('dialog', { name: 'レースを作成' });
  const course = raceDialog.getByLabel('コース');
  await expect(course).toHaveValue('turf');
  await expect(course.locator('option')).toHaveText(['芝', 'ダート']);
  await raceDialog.getByRole('button', { name: 'キャンセル' }).click();

  await page.getByRole('tab', { name: '馬管理' }).click();
  await page.getByRole('button', { name: '馬を登録' }).click();
  const horseDialog = page.getByRole('dialog', { name: '馬を登録' });
  await expect(horseDialog).toBeVisible();
  await expect(horseDialog.getByLabel('馬名')).toBeFocused();

  await expect(horseDialog.getByRole('group', { name: '基本能力' })).toBeVisible();
  await expect(horseDialog.getByRole('group', { name: '適性' })).toBeVisible();
  await expect(horseDialog.getByText('ノビ', { exact: true })).toBeVisible();
  await expect(horseDialog.getByText('末脚', { exact: true })).toHaveCount(0);
  await expect(horseDialog.getByText('各能力を0〜100で設定します。')).toHaveCount(0);
  await expect(
    horseDialog.getByText('中央は補正なし。片側へ寄せると、反対側では同じ分だけ不利になります。'),
  ).toHaveCount(0);
  await expect(horseDialog.getByText('中立', { exact: true })).toHaveCount(0);
  await expect(horseDialog.getByLabel('毛色')).toHaveValue('chestnut');
  await expect(horseDialog.getByLabel('毛色').locator('option')).toHaveText([
    '黒',
    '栗毛',
    'グレー',
    'クリーム',
  ]);
  await expect(horseDialog.getByRole('spinbutton')).toHaveCount(8);
  await expect(horseDialog.locator('.preference-slider__scale')).toHaveCount(0);

  const distance = horseDialog.getByRole('spinbutton', { name: '距離適性' });
  await distance.fill('-50');
  await distance.blur();
  await expect(distance).toHaveValue('-50');
  await expect(horseDialog.locator('output').filter({ hasText: /^-50$/ })).toBeVisible();

  const preference = horseDialog.getByRole('spinbutton', { name: 'コース適性' });
  await preference.fill('-100');
  await preference.blur();
  await expect(preference).toHaveValue('-100');
  await expect(horseDialog.locator('output').filter({ hasText: /^-100$/ })).toBeVisible();
  await preference.fill('100');
  await preference.blur();
  await expect(preference).toHaveValue('100');
  await expect(horseDialog.locator('output').filter({ hasText: /^100$/ })).toBeVisible();
  await expect(horseDialog.getByRole('spinbutton', { name: 'スピード' })).toHaveValue('50');

  const outputFont = await page
    .locator('.ability-slider output')
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(outputFont).toContain('Noto Sans JP Variable');
  await expect(horseDialog.locator('.preference-slider > input').first()).toHaveCSS(
    'border-left-color',
    'rgb(98, 98, 98)',
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
  expect(coloredAdminValues.length).toBe(0);

  const adminMotion = await page
    .locator('.app-shell--admin button')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { animationName: style.animationName, transitionDuration: style.transitionDuration };
    });
  expect(adminMotion.animationName).toBe('none');
  expect(adminMotion.transitionDuration).toBe('0s');

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
