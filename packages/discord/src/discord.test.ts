import { money, timestamp } from '@jcb/domain';
import type { Interaction } from 'discord.js';
import { renderRaceMessage } from './race-message.js';
import {
  handlePurchaseInteraction,
  isPurchaseSessionValid,
  parseStake,
  type PurchaseFlowDependencies,
} from './purchase-flow.js';

describe('Discord contracts', () => {
  it('orders horses by finishing position and prefixes a bold place label after settlement', () => {
    const message = renderRaceMessage({
      raceId: '01KZ21P85CEV9TV1S943C639WJ',
      version: 1,
      name: 'Discord試験',
      raceDate: '2026-08-03',
      distanceM: 1200,
      surfaceLabel: '芝',
      horses: Array.from({ length: 8 }, (_, index) => ({
        horseNumber: index + 1,
        name: `試験馬${index + 1}`,
        condition: 'normal' as const,
        currentWinOdds: '4.2',
      })),
      trifectaPoolTotal: money(15_000n),
      carryover: money(0n),
      canBuy: true,
      canView: false,
      finishOrder: [
        { horseNumber: 4, position: 1 },
        { horseNumber: 1, position: 2 },
        { horseNumber: 7, position: 3 },
        { horseNumber: 2, position: 4 },
        { horseNumber: 5, position: 5 },
        { horseNumber: 8, position: 6 },
        { horseNumber: 3, position: 7 },
        { horseNumber: 6, position: 8 },
      ],
    });
    const description = message.embeds[0].data.description ?? '';
    const lines = description.split('\n').filter((line) => line.startsWith('**'));
    expect(lines).toEqual([
      '**1着** `04` <:normal:1538151937269301348> 試験馬4  **4.2倍**',
      '**2着** `01` <:normal:1538151937269301348> 試験馬1  **4.2倍**',
      '**3着** `07` <:normal:1538151937269301348> 試験馬7  **4.2倍**',
      '**4着** `02` <:normal:1538151937269301348> 試験馬2  **4.2倍**',
      '**5着** `05` <:normal:1538151937269301348> 試験馬5  **4.2倍**',
      '**6着** `08` <:normal:1538151937269301348> 試験馬8  **4.2倍**',
      '**7着** `03` <:normal:1538151937269301348> 試験馬3  **4.2倍**',
      '**8着** `06` <:normal:1538151937269301348> 試験馬6  **4.2倍**',
    ]);
  });

  it('falls back to horse-number order when no finish order is provided', () => {
    const message = renderRaceMessage({
      raceId: '01KZ21P85CEV9TV1S943C639WJ',
      version: 1,
      name: 'Discord試験',
      raceDate: '2026-08-03',
      distanceM: 1200,
      surfaceLabel: '芝',
      horses: Array.from({ length: 8 }, (_, index) => ({
        horseNumber: index + 1,
        name: `試験馬${index + 1}`,
        condition: 'normal' as const,
        currentWinOdds: '4.2',
      })),
      trifectaPoolTotal: money(15_000n),
      carryover: money(0n),
      canBuy: true,
      canView: false,
    });
    const description = message.embeds[0].data.description ?? '';
    expect(description).toContain('`01` <:normal:1538151937269301348> 試験馬1  **4.2倍**');
    expect(description).not.toContain('1着');
  });

  it('renders eight horses within Discord component and embed limits', () => {
    const message = renderRaceMessage({
      raceId: '01KZ21P85CEV9TV1S943C639WJ',
      version: 1,
      name: 'Discord試験',
      raceDate: '2026-08-03',
      distanceM: 1200,
      surfaceLabel: '芝',
      horses: Array.from({ length: 8 }, (_, index) => ({
        horseNumber: index + 1,
        name: `試験馬${index + 1}`,
        condition: 'normal' as const,
        currentWinOdds: '4.2',
      })),
      trifectaPoolTotal: money(15_000n),
      carryover: money(0n),
      canBuy: true,
      canView: false,
    });
    const description = message.embeds[0].data.description ?? '';
    expect(description).toContain('開催日: 2026/08/03 / 1200m / 芝');
    expect(description).toContain('<:normal:1538151937269301348> 試験馬1');
    expect(description).not.toContain('発走');
    expect(description).not.toContain('締切');
    expect(description).not.toContain('通常レース');
    expect(message.components[0].components).toHaveLength(4);
    expect(
      message.components[0].components.some((component) => {
        const json = component.toJSON();
        return 'custom_id' in json && json.custom_id.startsWith('jcb:detail:');
      }),
    ).toBe(false);
    for (const component of message.components[0].components) {
      const json = component.toJSON();
      if ('custom_id' in json && json.custom_id !== undefined) {
        expect(json.custom_id.length).toBeLessThanOrEqual(100);
      }
    }
    expect(message.embeds[0].data.description?.length).toBeLessThan(4096);
  });

  it('validates modal stakes and rejects stale or foreign sessions', () => {
    expect(parseStake('100')).toBe(100n);
    expect(parseStake('99')).toBeUndefined();
    expect(parseStake('100.5')).toBeUndefined();
    const session = {
      id: 'session',
      discordUserId: 'user-1',
      raceId: 'race',
      raceVersion: 1,
      step: 'pool',
      payload: {},
      expiresAt: timestamp(2_000),
    };
    expect(isPurchaseSessionValid(session, 'user-1', 1_999)).toBe(true);
    expect(isPurchaseSessionValid(session, 'user-2', 1_999)).toBe(false);
    expect(isPurchaseSessionValid(session, 'user-1', 2_000)).toBe(false);
  });

  it('defers before loading all eight purchase options from Discord I/O', async () => {
    const events: string[] = [];
    let rendered: unknown;
    const session = {
      id: 'session',
      discordUserId: 'user-1',
      raceId: 'race-1',
      raceVersion: 1,
      step: 'pool',
      payload: {},
      expiresAt: timestamp(2_000),
    };
    const dependencies: PurchaseFlowDependencies = {
      clock: { now: () => timestamp(1_000) },
      sessions: {
        create: (input) => ({ id: 'session', ...input }),
        get: (id) => (id === session.id ? session : undefined),
        update: (id, expectedStep, step, payload) => {
          expect(id).toBe(session.id);
          expect(expectedStep).toBe('pool');
          return { ...session, step, payload };
        },
      },
      gateway: {
        currentRaceVersion: async () => 1,
        preview: async () => ({
          estimatedBasePayout: money(0n),
          estimatedCarryoverBonus: money(0n),
          balanceAfter: money(0n),
        }),
        purchase: async () => ({
          betId: 'unused',
          balanceAfter: money(0n),
          wasDuplicate: false,
        }),
        raceHorses: async () => {
          events.push('load-horses');
          return Array.from({ length: 8 }, (_, index) => ({
            number: index + 1,
            name: `試験馬${String(index + 1)}`,
          }));
        },
      },
    };
    const interaction = {
      customId: 'jcb:pool:session:win',
      user: { id: 'user-1' },
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      deferUpdate: async () => {
        events.push('defer');
      },
      editReply: async (message: unknown) => {
        rendered = message;
      },
    } as unknown as Interaction;

    expect(await handlePurchaseInteraction(interaction, dependencies)).toBe(true);
    expect(events).toEqual(['defer', 'load-horses']);
    const message = rendered as {
      readonly components: readonly [
        { toJSON(): { readonly components: readonly [{ readonly options: readonly unknown[] }] } },
      ];
    };
    expect(message.components[0].toJSON().components[0].options).toHaveLength(8);
  });

  it('leaves non-purchase jcb buttons for the Discord gateway', async () => {
    const interaction = {
      customId: 'jcb:view:race-1',
      user: { id: 'user-1' },
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
    } as unknown as Interaction;
    const dependencies = {
      clock: { now: () => timestamp(1_000) },
      sessions: {
        create: () => {
          throw new Error('not expected');
        },
        get: () => {
          throw new Error('non-purchase buttons must not load a purchase session');
        },
        update: () => {
          throw new Error('not expected');
        },
      },
      gateway: {},
    } as unknown as PurchaseFlowDependencies;

    expect(await handlePurchaseInteraction(interaction, dependencies)).toBe(false);
  });
});
