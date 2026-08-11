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
  it('renders eight horses within Discord component and embed limits', () => {
    const message = renderRaceMessage({
      raceId: '01KZ21P85CEV9TV1S943C639WJ',
      version: 1,
      name: 'Discord試験',
      raceDate: '2026-08-03',
      kindLabel: '通常レース',
      scheduledAtLabel: '08/03 22:00:00',
      distanceM: 1200,
      surfaceLabel: '芝',
      horses: Array.from({ length: 8 }, (_, index) => ({
        horseNumber: index + 1,
        name: `試験馬${index + 1}`,
        currentWinOdds: '4.2',
      })),
      trifectaPoolTotal: money(15_000n),
      carryover: money(0n),
      bettingClosesAtLabel: '08/03 21:59:30',
      statusLabel: '販売中',
      canBuy: true,
      canView: false,
    });
    expect(message.components[0].components).toHaveLength(5);
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
