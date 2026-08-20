import { money, timestamp } from '@jcb/domain';
import type { Interaction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { handlePurchaseInteraction, isPurchaseSessionValid } from './purchase-flow.js';
import type { PurchaseFlowDependencies } from './purchase-flow-context.js';
import { selectionFromSession } from './purchase-flow-validation.js';
import type { PurchaseSession, PurchaseSessionStore } from './types.js';

describe('purchase flow', () => {
  it('starts with an ephemeral embed and a disabled continuation button', async () => {
    const store = memoryStore(poolSession());
    let rendered: unknown;

    expect(
      await handlePurchaseInteraction(
        beginInteraction((message) => {
          rendered = message;
        }),
        dependenciesFor(store),
      ),
    ).toBe(true);

    const message = rendered as {
      readonly content: null;
      readonly embeds: readonly [{ toJSON(): { readonly description?: string } }];
      readonly components: readonly [
        { toJSON(): { readonly components: readonly [{ readonly options: readonly unknown[] }] } },
        { toJSON(): { readonly components: readonly [{ readonly disabled?: boolean }] } },
      ];
    };
    expect(message.content).toBeNull();
    expect(message.embeds[0].toJSON().description).toBe('券種を選択してください。');
    const options = message.components[0].toJSON().components[0].options as readonly {
      readonly label: string;
      readonly value: string;
    }[];
    expect(options.map((option) => option.label)).toEqual([
      '単勝',
      '複勝',
      '馬連',
      '馬単',
      'ワイド',
      '3連複',
      '3連単',
    ]);
    expect(options.map((option) => option.value)).toEqual([
      'win',
      'place',
      'quinella',
      'exacta',
      'wide',
      'trio',
      'trifecta',
    ]);
    expect(message.components[1].toJSON().components[0].disabled).toBe(true);
  });

  it('updates the same ephemeral message with the selected pool description', async () => {
    const store = memoryStore(poolSession());
    let rendered: unknown;
    const interaction = poolSelectInteraction('wide', (message) => {
      rendered = message;
    });

    expect(await handlePurchaseInteraction(interaction, dependenciesFor(store))).toBe(true);
    expect(store.current().step).toBe('pool');
    expect(store.current().payload).toEqual({ poolType: 'wide' });
    expect(interaction.deferUpdate.mock.calls).toHaveLength(1);

    const message = rendered as {
      readonly embeds: readonly [{ toJSON(): { readonly description?: string } }];
      readonly components: readonly [
        unknown,
        { toJSON(): { readonly components: readonly [{ readonly disabled?: boolean }] } },
      ];
    };
    expect(message.embeds[0].toJSON().description).toBe(
      '3着までに入る2頭を、着順を問わずに当てる馬券。',
    );
    expect(message.components[1].toJSON().components[0].disabled).toBe(false);
  });

  it('confirms the selected pool before entering the horse selection step', async () => {
    const store = memoryStore(poolSession({ poolType: 'quinella' }));
    let rendered: unknown;
    const interaction = buttonInteraction('jcb:pool-confirm:session', (message) => {
      rendered = message;
    });

    expect(await handlePurchaseInteraction(interaction, dependenciesFor(store))).toBe(true);
    expect(store.current().step).toBe('pick-1');
    expect(store.current().payload).toEqual({ poolType: 'quinella' });
    expect((rendered as { readonly content: string }).content).toBe('馬連 1頭目を選んでください。');
    expect((rendered as { readonly embeds: readonly unknown[] }).embeds).toEqual([]);
  });

  it('normalizes unordered selections while preserving ordered selections', () => {
    const session = poolSession({ poolType: 'wide', first: '8', second: '2' });
    expect(selectionFromSession(session, 'wide')).toBe('2-8');
    expect(
      selectionFromSession(
        { ...session, payload: { ...session.payload, poolType: 'exacta' } },
        'exacta',
      ),
    ).toBe('8-2');
  });

  it('locks the amount step during preview and stores a canonical stake', async () => {
    const store = memoryStore(amountSession({ poolType: 'win', first: '1' }));
    const previewResult = deferred<{
      estimatedBasePayout: ReturnType<typeof money>;
      estimatedCarryoverBonus: ReturnType<typeof money>;
      balanceAfter: ReturnType<typeof money>;
    }>();
    const previewStarted = deferred<boolean>();
    let previewCalls = 0;
    let rendered: unknown;
    const dependencies = dependenciesFor(store, {
      preview: async () => {
        previewCalls += 1;
        previewStarted.resolve(true);
        return previewResult.promise;
      },
    });
    const first = handlePurchaseInteraction(
      amountInteraction('amount-interaction-1', '000100', (message) => {
        rendered = message;
      }),
      dependencies,
    );

    await previewStarted.promise;
    expect(store.current().step).toBe('previewing');
    await expect(
      handlePurchaseInteraction(
        amountInteraction('amount-interaction-2', '000100', () => undefined),
        dependencies,
      ),
    ).rejects.toThrow('Purchase session step is stale.');
    expect(previewCalls).toBe(1);

    previewResult.resolve({
      estimatedBasePayout: money(200n),
      estimatedCarryoverBonus: money(0n),
      balanceAfter: money(900n),
    });
    await first;

    expect(store.current().step).toBe('confirm');
    expect(store.current().payload.stake).toBe('100');
    expect((rendered as { readonly content: string }).content).toContain('賭け金: 100 R');
  });

  it('returns an invalid amount to the final selection step so the user can retry', async () => {
    const store = memoryStore(
      amountSession({ poolType: 'trifecta', first: '1', second: '2', third: '3' }),
    );
    let rendered: unknown;

    expect(
      await handlePurchaseInteraction(
        amountInteraction('amount-interaction', '99', (message) => {
          rendered = message;
        }),
        dependenciesFor(store),
      ),
    ).toBe(true);

    expect(rendered).toBe('賭け金は100ルピー以上の整数で入力してください。');
    expect(store.current().step).toBe('pick-3');
    expect(store.current().payload).toEqual({ poolType: 'trifecta', first: '1', second: '2' });
  });

  it('uses the session transition as a purchase mutex', async () => {
    const store = memoryStore({
      ...amountSession({
        poolType: 'win',
        first: '1',
        stake: '100',
        selectionCode: '1',
      }),
      step: 'confirm',
    });
    const purchaseResult = deferred<{
      betId: string;
      balanceAfter: ReturnType<typeof money>;
      wasDuplicate: boolean;
    }>();
    const purchaseStarted = deferred<boolean>();
    let purchaseCalls = 0;
    const dependencies = dependenciesFor(store, {
      purchase: async () => {
        purchaseCalls += 1;
        purchaseStarted.resolve(true);
        return purchaseResult.promise;
      },
    });
    const first = handlePurchaseInteraction(confirmInteraction('confirm-1'), dependencies);

    await purchaseStarted.promise;
    expect(store.current().step).toBe('processing');
    await expect(
      handlePurchaseInteraction(confirmInteraction('confirm-2'), dependencies),
    ).rejects.toThrow('Purchase session step is stale.');
    expect(purchaseCalls).toBe(1);

    purchaseResult.resolve({ betId: 'bet-1', balanceAfter: money(900n), wasDuplicate: false });
    await first;
    expect(store.current().step).toBe('completed');
  });

  it('rejects malformed routes without touching session state', async () => {
    const dependencies = dependenciesFor({
      create: () => {
        throw new Error('not expected');
      },
      get: () => {
        throw new Error('malformed routes must not load a session');
      },
      update: () => {
        throw new Error('not expected');
      },
    });
    const interaction = {
      customId: 'jcb:confirm:session:unexpected',
      user: { id: 'user-1' },
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
    } as unknown as Interaction;

    expect(await handlePurchaseInteraction(interaction, dependencies)).toBe(false);
  });

  it('treats corrupted session steps as stale', () => {
    expect(
      isPurchaseSessionValid(
        { ...amountSession({ poolType: 'win', first: '1' }), step: 'unknown' },
        'user-1',
        1_000,
      ),
    ).toBe(false);
  });
});

function amountSession(payload: Readonly<Record<string, string>>): PurchaseSession {
  return {
    id: 'session',
    discordUserId: 'user-1',
    raceId: 'race-1',
    raceVersion: 1,
    step: 'amount',
    payload,
    expiresAt: timestamp(10_000),
  };
}

function poolSession(payload: Readonly<Record<string, string>> = {}): PurchaseSession {
  return {
    id: 'session',
    discordUserId: 'user-1',
    raceId: 'race-1',
    raceVersion: 1,
    step: 'pool',
    payload,
    expiresAt: timestamp(10_000),
  };
}

function memoryStore(initial: PurchaseSession): PurchaseSessionStore & {
  readonly current: () => PurchaseSession;
} {
  let current = initial;
  return {
    current: () => current,
    create: (input) => {
      current = { id: 'session', ...input };
      return current;
    },
    get: (id) => (id === current.id ? current : undefined),
    update: (id, expectedStep, step, payload) => {
      if (id !== current.id || current.step !== expectedStep) {
        throw new Error('Purchase session is expired, missing, or was updated concurrently.');
      }
      current = { ...current, step, payload };
      return current;
    },
  };
}

function dependenciesFor(
  sessions: PurchaseSessionStore,
  overrides: Partial<PurchaseFlowDependencies['gateway']> = {},
): PurchaseFlowDependencies {
  return {
    clock: { now: () => timestamp(1_000) },
    sessions,
    gateway: {
      currentRaceVersion: async () => 1,
      raceHorses: async () =>
        Array.from({ length: 8 }, (_, index) => ({
          number: index + 1,
          name: `試験馬${String(index + 1)}`,
        })),
      preview: async () => ({
        estimatedBasePayout: money(200n),
        estimatedCarryoverBonus: money(0n),
        balanceAfter: money(900n),
      }),
      purchase: async () => ({ betId: 'bet-1', balanceAfter: money(900n), wasDuplicate: false }),
      ...overrides,
    },
  };
}

function amountInteraction(
  id: string,
  stake: string,
  editReply: (message: unknown) => void,
): Interaction {
  return {
    id,
    customId: 'jcb:amount:session',
    user: { id: 'user-1' },
    fields: { getTextInputValue: () => stake },
    isButton: () => false,
    isStringSelectMenu: () => false,
    isModalSubmit: () => true,
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async (message: unknown) => editReply(message)),
  } as unknown as Interaction;
}

function beginInteraction(editReply: (message: unknown) => void): Interaction {
  return {
    id: 'buy-interaction',
    customId: 'jcb:buy:race-1',
    user: { id: 'user-1' },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async (message: unknown) => editReply(message)),
  } as unknown as Interaction;
}

function poolSelectInteraction(
  poolType: string,
  editReply: (message: unknown) => void,
): Interaction & { readonly deferUpdate: ReturnType<typeof vi.fn> } {
  return {
    id: 'pool-interaction',
    customId: 'jcb:pool:session',
    user: { id: 'user-1' },
    values: [poolType],
    isButton: () => false,
    isStringSelectMenu: () => true,
    isModalSubmit: () => false,
    deferUpdate: vi.fn(async () => undefined),
    editReply: vi.fn(async (message: unknown) => editReply(message)),
  } as unknown as Interaction & { readonly deferUpdate: ReturnType<typeof vi.fn> };
}

function buttonInteraction(customId: string, editReply: (message: unknown) => void): Interaction {
  return {
    id: 'button-interaction',
    customId,
    user: { id: 'user-1' },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    deferUpdate: vi.fn(async () => undefined),
    editReply: vi.fn(async (message: unknown) => editReply(message)),
  } as unknown as Interaction;
}

function confirmInteraction(id: string): Interaction {
  return {
    id,
    customId: 'jcb:confirm:session',
    user: { id: 'user-1' },
    isButton: () => true,
    isStringSelectMenu: () => false,
    isModalSubmit: () => false,
    deferUpdate: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as Interaction;
}

function deferred<Value>(): {
  readonly promise: Promise<Value>;
  readonly resolve: (value: Value) => void;
} {
  let resolve!: (value: Value) => void;
  const promise = new Promise<Value>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}
