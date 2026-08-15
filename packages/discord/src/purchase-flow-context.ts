import type { Clock } from '@jcb/domain';
import type { DiscordPurchaseGateway, PurchaseSessionStore } from './types.js';

export interface PurchaseFlowDependencies {
  readonly sessions: PurchaseSessionStore;
  readonly gateway: DiscordPurchaseGateway;
  readonly clock: Clock;
}
