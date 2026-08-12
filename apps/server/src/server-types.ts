import type { FastifyRequest } from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Environment } from '@jcb/config';
import type { AdminNotice } from './admin-notification.js';
import type {
  SqliteAdminStore,
  SqliteAuthStore,
  SqliteGameStore,
  SqliteJobStore,
  SqliteRaceLifecycleStore,
  SqliteViewerStore,
  SqliteDatabase,
} from '@jcb/database';
import type { Clock, Timestamp } from '@jcb/domain';
import type { PrivateObjectStore } from '@jcb/application';
import type { GuildMembership } from '@jcb/application';

export interface ServerDependencies {
  readonly database: SqliteDatabase;
  readonly environment: Environment;
  readonly clock: Clock;
  readonly membership: GuildMembership;
  readonly discordStatus?: () => boolean;
  readonly adminNotifier?: (notice: AdminNotice) => Promise<void>;
  readonly timelineStore?: PrivateObjectStore;
}

export interface AuthenticatedSession {
  readonly id: string;
  readonly discordUserId: string;
  readonly reauthenticatedAt?: number;
}

export interface AuthenticateOptions {
  readonly csrf?: boolean;
  readonly admin?: boolean;
}

export type Authenticate = (
  request: FastifyRequest,
  options?: AuthenticateOptions,
) => Promise<AuthenticatedSession>;

export interface ServerRouteContext {
  readonly app: FastifyInstance;
  readonly dependencies: ServerDependencies;
  readonly now: () => Timestamp;
  readonly authStore: SqliteAuthStore;
  readonly gameStore: SqliteGameStore;
  readonly viewerStore: SqliteViewerStore;
  readonly adminStore: SqliteAdminStore;
  readonly lifecycle: SqliteRaceLifecycleStore;
  readonly jobStore: SqliteJobStore;
  readonly sessionSecret: string;
  readonly authenticate: Authenticate;
  readonly notifyAdmin: (notice: AdminNotice) => Promise<void>;
}
