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
    const result =
      path.endsWith('/auth/csrf') || path.endsWith('/auth/admin/csrf')
        ? { csrfToken: 'test-csrf-token' }
        : path.endsWith('/admin/settings')
          ? { gameSettings: publicSettings, history: [] }
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
  await expect(page.locator('.app-shell--admin')).toHaveCSS('background-color', 'rgb(13, 13, 13)');
  expect((await page.locator('main').boundingBox())?.width).toBeLessThanOrEqual(1_408);

  await page.getByRole('button', { name: 'レースを作成' }).click();
  const raceDialog = page.getByRole('dialog', { name: 'レースを作成' });
  const course = raceDialog.getByRole('combobox', { name: 'コース' });
  await expect(course).toHaveText('芝');
  await expect(raceDialog.locator('input[name="surface"]')).toHaveValue('turf');
  await course.click();
  await expect(raceDialog.getByRole('listbox').getByRole('option')).toHaveText(['芝', 'ダート']);
  await page.keyboard.press('Escape');
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
  const coat = horseDialog.getByRole('combobox', { name: '毛色' });
  await expect(coat).toHaveText('栗毛');
  await expect(horseDialog.locator('input[name="coatColor"]')).toHaveValue('chestnut');
  await coat.click();
  await expect(horseDialog.getByRole('listbox').getByRole('option')).toHaveText([
    '黒',
    '栗毛',
    'グレー',
    'クリーム',
  ]);
  await page.keyboard.press('Escape');
  await expect(horseDialog.getByRole('spinbutton')).toHaveCount(8);
  await expect(horseDialog.locator('.preference-slider__scale')).toHaveCount(0);
  await expect(horseDialog.locator('output')).toHaveCount(0);

  const distance = horseDialog.getByRole('spinbutton', { name: '距離適性' });
  await distance.fill('-50');
  await distance.blur();
  await expect(distance).toHaveValue('-50');

  const preference = horseDialog.getByRole('spinbutton', { name: 'コース適性' });
  await preference.fill('-100');
  await preference.blur();
  await expect(preference).toHaveValue('-100');
  await preference.fill('100');
  await preference.blur();
  await expect(preference).toHaveValue('100');
  await expect(horseDialog.getByRole('spinbutton', { name: 'スピード' })).toHaveValue('50');

  const valueFont = await page
    .locator('.ability-slider__heading input')
    .first()
    .evaluate((element) => getComputedStyle(element).fontFamily);
  expect(valueFont).toContain('Noto Sans JP Variable');
  await expect(horseDialog.locator('.preference-slider__heading input').first()).toHaveCSS(
    'border-left-color',
    'rgb(33, 33, 33)',
  );
  // The marker is placed rather than filled, so a rule that only sets its
  // offset leaves it with no width and nothing on screen.
  const markerWidth = await horseDialog
    .locator('.preference-meter span')
    .first()
    .evaluate((element) => element.getBoundingClientRect().width);
  expect(markerWidth).toBeGreaterThan(0);
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
  // The chrome stays grey. Colour is allowed, but only the three tokens that
  // carry a meaning: the accent, a failure, and a warning.
  const SEMANTIC_COLOURS = ['rgb(50, 145, 255)', 'rgb(255, 99, 105)', 'rgb(245, 166, 35)'];
  expect(coloredAdminValues.filter((value) => !SEMANTIC_COLOURS.includes(value))).toEqual([]);

  const adminMotion = await page
    .locator('.app-shell--admin button')
    .first()
    .evaluate((element) => {
      const style = getComputedStyle(element);
      return { animationName: style.animationName, transitionDuration: style.transitionDuration };
    });
  // A control may answer a hover, and nothing more: no keyframes, and a change
  // of state inside the 120-180ms the design system allows for one.
  expect(adminMotion.animationName).toBe('none');
  const durations = adminMotion.transitionDuration
    .split(',')
    .map((duration) => Number.parseFloat(duration) * 1_000);
  expect(Math.max(...durations)).toBeLessThanOrEqual(180);

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
