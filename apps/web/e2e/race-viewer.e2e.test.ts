import { createCipheriv, randomBytes } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

test('loads a verified timeline with replay and camera controls', async ({ page }, testInfo) => {
  test.setTimeout(150_000);
  test.skip(
    process.env.CI === 'true' && testInfo.project.name === 'mobile-ios-360',
    'Headless WebKit intermittently terminates its GPU process while rendering this 3D scene on Linux CI.',
  );
  await page.addInitScript(() => {
    (window as unknown as { audioContextCreations: number }).audioContextCreations = 0;
    class ConsentAudioContext {
      public readonly currentTime = 0;
      public readonly destination = {};
      public constructor() {
        (window as unknown as { audioContextCreations: number }).audioContextCreations += 1;
      }
      public resume() {
        return Promise.resolve();
      }
      public close() {
        return Promise.resolve();
      }
      public createOscillator() {
        return {
          type: 'square',
          frequency: { value: 0 },
          connect() {
            return this;
          },
          start() {
            return;
          },
          stop() {
            return;
          },
        };
      }
      public createGain() {
        return {
          gain: {
            setValueAtTime() {
              return;
            },
            linearRampToValueAtTime() {
              return;
            },
            exponentialRampToValueAtTime() {
              return;
            },
          },
          connect() {
            return this;
          },
        };
      }
    }
    Object.defineProperty(window, 'AudioContext', {
      configurable: true,
      value: ConsentAudioContext,
    });
  });

  const scheduledAt = Date.now();
  const encrypted = encryptTimeline(timelineFixture());
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
          : path.endsWith('/edge-token')
            ? { edgeAccessToken: 'edge-test-token' }
            : raceFixture(scheduledAt);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ apiVersion: 'v1', result }),
    });
  });
  await page.route('**/edge/v1/races/viewer-test/release', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        apiVersion: 'v1',
        result: {
          raceId: 'viewer-test',
          scheduledStart: scheduledAt,
          timelineDuration: 4_000,
          timelineKey: encrypted.key,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          codecVersion: 'json-gzip-v1',
          timelinePath: '/edge/v1/races/viewer-test/timeline',
        },
      }),
    });
  });
  await page.route('**/edge/v1/races/viewer-test/timeline', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: encrypted.ciphertext,
    });
  });

  await page.goto('/races/viewer-test');
  await page
    .getByRole('button', { name: '一時停止' })
    .dispatchEvent('click', undefined, { timeout: 120_000 });
  await expect(page.getByRole('img', { name: '8頭のレース進行アニメーション' })).toBeVisible();
  await expect(page.locator('.broadcast-clock output')).toHaveCSS(
    'font-family',
    /Noto Sans JP Variable/,
  );
  await expect(page.getByRole('button', { name: '再生' })).toBeVisible();
  const horseFour = page.getByRole('button', { name: /4番を追尾/ });
  await horseFour.dispatchEvent('click');
  await expect(horseFour).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '放送カメラに戻す' })).toBeVisible();
  await page.getByRole('button', { name: '放送カメラに戻す' }).dispatchEvent('click');
  await expect(horseFour).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: '1位を追尾' })).toBeVisible();
  const horseOne = page.getByRole('button', { name: /1番を追尾/ });
  await page.getByRole('button', { name: '1位を追尾' }).dispatchEvent('click');
  await expect(horseOne).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('button', { name: '放送カメラに戻す' })).toBeVisible();
  await expect(page.getByText('ドラッグ 回転 · ホイール ズーム')).toHaveCount(0);
  await page.getByRole('button', { name: '放送カメラに戻す' }).dispatchEvent('click');
  await expect(horseOne).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByRole('button', { name: '1位を追尾' })).toBeVisible();
  await expect(page.locator('.running-order small')).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { audioContextCreations: number }).audioContextCreations,
    ),
  ).toBe(0);
  await expect(page.getByRole('button', { name: /音声/ })).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { audioContextCreations: number }).audioContextCreations,
    ),
  ).toBe(0);
  await page.getByRole('button', { name: '再生' }).dispatchEvent('click');
  await expect(
    page.getByRole('img', { name: '1位がゴールした瞬間のフィニッシュ写真' }),
  ).toBeVisible({
    timeout: 20_000,
  });
  await expect(page.getByRole('region', { name: '確定結果' })).toBeVisible({ timeout: 20_000 });
  await expect(page.locator('.podium-card')).toHaveCount(3);
});

function timelineFixture() {
  const finalFrame = 40;
  const finishFrames = [32, 33, 34, 35, 36, 37, 38, 40];
  return Array.from({ length: finalFrame + 1 }, (_, frame) => ({
    timeMs: frame * 100,
    horses: Array.from({ length: 8 }, (_, index) => ({
      horseNumber: index + 1,
      progress: Math.min(1, frame / finishFrames[index]!),
      laneIndex: index,
      lateralOffset: 0,
      rank: index + 1,
      speed: frame === 0 ? 0 : 16,
      animationState:
        frame === 0 ? 'waiting' : frame >= finishFrames[index]! ? 'finished' : 'running',
    })),
  }));
}

function encryptTimeline(timeline: ReturnType<typeof timelineFixture>) {
  const key = randomBytes(32);
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(gzipSync(Buffer.from(JSON.stringify(timeline)))),
    cipher.final(),
  ]);
  return {
    key: key.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext,
  };
}

function raceFixture(scheduledAt: number) {
  return {
    id: 'viewer-test',
    raceDate: '2026-08-03',
    name: '観戦機能試験',
    kind: 'regular',
    status: 'running',
    version: 1,
    distanceM: 1_200,
    surface: 'turf',
    scheduledAt,
    bettingClosesAt: scheduledAt - 30_000,
    viewerOpensAt: scheduledAt - 5 * 60_000,
    entries: Array.from({ length: 8 }, (_, index) => ({
      horseNumber: index + 1,
      horseId: `horse-${String(index + 1)}`,
      name: `観戦試験馬${String(index + 1)}`,
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
