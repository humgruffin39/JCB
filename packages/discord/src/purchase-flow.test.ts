import { money, timestamp } from '@jcb/domain';
import type { Interaction } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { handlePurchaseInteraction, isPurchaseSessionValid } from './purchase-flow.js';
import type { PurchaseFlowDependencies } from './purchase-flow-context.js';
import { selectionsFromSession } from './purchase-flow-validation.js';
import type { PurchaseSession, PurchaseSessionStore } from './types.js';

describe('purchase flow', () => {
  it('starts with only the pool menu and a disabled continuation button', async () => {
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
      readonly components: readonly [
        { toJSON(): { readonly components: readonly [{ readonly options: readonly unknown[] }] } },
        { toJSON(): { readonly components: readonly [{ readonly disabled?: boolean }] } },
      ];
    };
    expect(rendered).not.toHaveProperty('content');
    expect(rendered).not.toHaveProperty('embeds');
    const options = message.components[0].toJSON().components[0].options as readonly {
      readonly label: string;
      readonly value: string;
      readonly default?: boolean;
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
    expect(options.filter((option) => option.default).map((option) => option.value)).toEqual([]);
    expect(message.components[1].toJSON().components[0].disabled).toBe(true);
  });

  it('updates the same ephemeral message with the selected pool', async () => {
    const store = memoryStore(poolSession());
    let rendered: unknown;
    const interaction = poolSelectInteraction('wide', (message) => {
      rendered = message;
    });

    expect(await handlePurchaseInteraction(interaction, dependenciesFor(store))).toBe(true);
    expect(store.current().step).toBe('pool');
    expect(store.current().payload).toEqual({ poolType: 'wide' });
    expect(interaction.deferUpdate.mock.calls).toHaveLength(1);
    expect(interaction.editReply.mock.calls).toHaveLength(1);

    const message = rendered as {
      readonly components: readonly [
        {
          toJSON(): {
            readonly components: readonly [
              {
                readonly placeholder?: string;
                readonly options: readonly [{ readonly value: string; readonly default?: boolean }];
              },
            ];
          };
        },
        { toJSON(): { readonly components: readonly [{ readonly disabled?: boolean }] } },
      ];
    };
    expect(rendered).not.toHaveProperty('content');
    expect(rendered).not.toHaveProperty('embeds');
    const menu = message.components[0].toJSON().components[0];
    expect(menu.placeholder).toBe('ワイド');
    expect(menu.options.filter((option) => option.default).map((option) => option.value)).toEqual([
      'wide',
    ]);
    expect(message.components[1].toJSON().components[0].disabled).toBe(false);
  });

  it('confirms the selected pool before entering the horse selection step', async () => {
    const store = memoryStore(poolSession({ poolType: 'quinella' }));
    let rendered: unknown;
    const interaction = buttonInteraction('jcb:pool-confirm:session', (message) => {
      rendered = message;
    });

    expect(await handlePurchaseInteraction(interaction, dependenciesFor(store))).toBe(true);
    expect(store.current().step).toBe('picks');
    expect(store.current().payload).toEqual({ poolType: 'quinella' });
    expect((rendered as { readonly content: string }).content).toBe(
      ['馬連', '１頭目: 未選択', '２頭目: 未選択', '点数: —'].join('\n'),
    );
    expect((rendered as { readonly embeds: readonly unknown[] }).embeds).toEqual([]);
  });

  it('normalizes unordered selections while preserving ordered selections', () => {
    const session = poolSession({ poolType: 'wide', first: '8', second: '2' });
    expect(selectionsFromSession(session, 'wide')).toEqual(['2-8']);
    expect(
      selectionsFromSession(
        { ...session, payload: { ...session.payload, poolType: 'exacta' } },
        'exacta',
      ),
    ).toEqual(['8-2']);
  });

  it('expands a formation into every combination and drops the impossible ones', () => {
    const session = poolSession({ poolType: 'trifecta', first: '6', second: '1,2', third: '1,2' });
    expect(selectionsFromSession(session, 'trifecta')).toEqual(['6-1-2', '6-2-1']);
  });

  it('collapses a box of the same horses to the combinations an unordered ticket has', () => {
    const session = poolSession({
      poolType: 'trio',
      first: '1,2,3',
      second: '1,2,3',
      third: '1,2,3',
    });
    expect(selectionsFromSession(session, 'trio')).toEqual(['1-2-3']);
  });

  it('keeps every position on one screen and counts the points while they are chosen', async () => {
    const store = memoryStore(picksSession({ poolType: 'trifecta', first: '6' }));
    let rendered: unknown;

    expect(
      await handlePurchaseInteraction(
        pickInteraction(2, ['3', '1', '2'], (message) => {
          rendered = message;
        }),
        dependenciesFor(store),
      ),
    ).toBe(true);

    expect(store.current().step).toBe('picks');
    expect(store.current().payload).toEqual({ poolType: 'trifecta', first: '6', second: '1,2,3' });
    const message = rendered as {
      readonly content: string;
      readonly components: readonly {
        toJSON(): {
          readonly components: readonly {
            readonly label?: string;
            readonly disabled?: boolean;
            readonly max_values?: number;
            readonly options?: readonly { readonly value: string; readonly default?: boolean }[];
          }[];
        };
      }[];
    };
    expect(message.content).toContain('３着: 未選択');
    expect(message.content).toContain('点数: —');
    const second = message.components[1]!.toJSON().components[0]!;
    expect(second.max_values).toBe(8);
    expect(
      second.options?.filter((option) => option.default).map((option) => option.value),
    ).toEqual(['1', '2', '3']);
    // Nothing to price until every position is filled.
    expect(message.components[3]!.toJSON().components[1]!.disabled).toBe(true);
  });

  it('boxes a formation by copying the first position over the rest', async () => {
    const store = memoryStore(picksSession({ poolType: 'trifecta', first: '1,2,3' }));
    let rendered: unknown;

    expect(
      await handlePurchaseInteraction(
        buttonInteraction('jcb:box:session', (message) => {
          rendered = message;
        }),
        dependenciesFor(store),
      ),
    ).toBe(true);

    expect(store.current().payload).toEqual({
      poolType: 'trifecta',
      first: '1,2,3',
      second: '1,2,3',
      third: '1,2,3',
    });
    const message = rendered as {
      readonly content: string;
      readonly components: readonly {
        toJSON(): { readonly components: readonly { readonly label?: string }[] };
      }[];
    };
    expect(message.content).toContain('点数: 6点');
    expect(message.components[3]!.toJSON().components[1]!.label).toBe('賭け金を入力（6点）');
  });

  it('keeps the selection screen usable after the amount modal is dismissed', async () => {
    // Discord reports nothing when a modal is closed, so the session is still
    // parked on the amount step when the next click arrives.
    const store = memoryStore({
      ...picksSession({ poolType: 'trifecta', first: '6', second: '1,2', third: '1,2' }),
      step: 'amount',
    });
    let rendered: unknown;

    expect(
      await handlePurchaseInteraction(
        pickInteraction(1, ['5'], (message) => {
          rendered = message;
        }),
        dependenciesFor(store),
      ),
    ).toBe(true);

    expect(store.current().step).toBe('picks');
    expect(store.current().payload).toMatchObject({ first: '5' });
    expect((rendered as { readonly content: string }).content).toContain('点数: 2点');
  });

  it('says the buy cannot fit instead of asking for an impossible stake', async () => {
    const store = memoryStore(
      picksSession({
        poolType: 'trifecta',
        first: '1,2,3,4,5,6,7,8',
        second: '1,2,3,4,5,6,7,8',
        third: '1,2,3,4,5,6,7,8',
      }),
    );
    let replied: unknown;
    const interaction = {
      id: 'picks-interaction',
      customId: 'jcb:picks:session',
      user: { id: 'user-1' },
      isButton: () => true,
      isStringSelectMenu: () => false,
      isModalSubmit: () => false,
      reply: vi.fn(async (message: unknown) => {
        replied = message;
      }),
      showModal: vi.fn(async () => {
        throw new Error('the modal must not open');
      }),
      deferUpdate: vi.fn(async () => undefined),
      editReply: vi.fn(async () => undefined),
    } as unknown as Interaction;

    expect(await handlePurchaseInteraction(interaction, dependenciesFor(store))).toBe(true);
    expect((replied as { readonly content: string }).content).toContain('336点');
    expect(store.current().step).toBe('picks');
  });

  it('rejects a formation that would spend more than the race allows', async () => {
    const store = memoryStore(
      amountSession({
        poolType: 'trifecta',
        first: '1,2,3,4',
        second: '1,2,3,4',
        third: '1,2,3,4',
      }),
    );
    let rendered: unknown;

    expect(
      await handlePurchaseInteraction(
        amountInteraction('amount-interaction', '500', (message) => {
          rendered = message;
        }),
        dependenciesFor(store, {
          preview: async () => {
            throw new Error('the cap must be checked before pricing');
          },
        }),
      ),
    ).toBe(true);

    expect(rendered).toBe(
      '24点 × 500 CP = 12,000 CP で、このレースの上限 5,000 CP を超えています。',
    );
    expect(store.current().step).toBe('picks');
  });

  it('locks the amount step during preview and stores a canonical stake', async () => {
    const store = memoryStore(amountSession({ poolType: 'win', first: '1' }));
    const previewResult = deferred<ReturnType<typeof previewFixture>>();
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

    previewResult.resolve(previewFixture());
    await first;

    expect(store.current().step).toBe('confirm');
    expect(store.current().payload.stake).toBe('100');
    expect((rendered as { readonly content: string }).content).toContain('賭け金: 100 CP');
    expect((rendered as { readonly content: string }).content).toContain(
      '単勝の馬: <:horse_1:1539913567787159653>',
    );
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

    expect(rendered).toBe('賭け金は100CP以上の整数で入力してください。');
    expect(store.current().step).toBe('picks');
    expect(store.current().payload).toEqual({
      poolType: 'trifecta',
      first: '1',
      second: '2',
      third: '3',
    });
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
    const purchaseResult = deferred<ReturnType<typeof receiptFixture>>();
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

    purchaseResult.resolve(receiptFixture());
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

function previewFixture() {
  return {
    points: 1,
    totalStake: money(100n),
    minimumPayout: money(200n),
    maximumPayout: money(200n),
    includesCarryover: false,
    balanceAfter: money(900n),
  };
}

function receiptFixture() {
  return {
    betId: 'bet-1',
    points: 1,
    totalStake: money(100n),
    balanceAfter: money(900n),
    wasDuplicate: false,
  };
}

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

function picksSession(payload: Readonly<Record<string, string>>): PurchaseSession {
  return { ...poolSession(payload), step: 'picks' };
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
      raceBetLimit: async () => money(5_000n),
      raceHorses: async () =>
        Array.from({ length: 8 }, (_, index) => ({
          number: index + 1,
          name: `試験馬${String(index + 1)}`,
        })),
      preview: async () => previewFixture(),
      purchase: async () => receiptFixture(),
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
): Interaction & {
  readonly deferUpdate: ReturnType<typeof vi.fn>;
  readonly editReply: ReturnType<typeof vi.fn>;
} {
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
  } as unknown as Interaction & {
    readonly deferUpdate: ReturnType<typeof vi.fn>;
    readonly editReply: ReturnType<typeof vi.fn>;
  };
}

function pickInteraction(
  position: number,
  values: readonly string[],
  editReply: (message: unknown) => void,
): Interaction {
  return {
    id: 'pick-interaction',
    customId: `jcb:pick:session:${String(position)}`,
    user: { id: 'user-1' },
    values,
    isButton: () => false,
    isStringSelectMenu: () => true,
    isModalSubmit: () => false,
    deferUpdate: vi.fn(async () => undefined),
    editReply: vi.fn(async (message: unknown) => editReply(message)),
  } as unknown as Interaction;
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
