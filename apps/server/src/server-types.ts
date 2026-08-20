import type { FastifyRequest } from 'fastify';
import type { FastifyInstance } from 'fastify';
import type { Environment } from '@jcb/config';
import type { AdminNotice } from './admin-notification.js';
import type {
  SqliteAdminStore,
  SqliteActivityStore,
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
import type { DiscordActivityApi } from './discord-activity-api.js';

export interface ServerDependencies {
  readonly database: SqliteDatabase;
  readonly environment: Environment;
  readonly clock: Clock;
  readonly membership: GuildMembership;
  readonly discordStatus?: () => boolean;
  readonly adminNotifier?: (notice: AdminNotice) => Promise<void>;
  readonly timelineStore?: PrivateObjectStore;
  readonly activityApi?: DiscordActivityApi;
}

export interface AuthenticatedSession {
  readonly id: string;
  readonly discordUserId: string;
  readonly activityInstanceId?: string;
  readonly reauthenticatedAt?: number;
  readonly authenticationMethod?: 'web' | 'activity';
}

export interface AuthenticateOptions {
  readonly csrf?: boolean;
  readonly admin?: boolean;
  readonly raceId?: string;
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
  readonly activityStore: SqliteActivityStore;
  readonly activityApi: DiscordActivityApi;
  readonly gameStore: SqliteGameStore;
  readonly viewerStore: SqliteViewerStore;
  readonly adminStore: SqliteAdminStore;
  readonly lifecycle: SqliteRaceLifecycleStore;
  readonly jobStore: SqliteJobStore;
  readonly sessionSecret: string;
  readonly authenticate: Authenticate;
  readonly notifyAdmin: (notice: AdminNotice) => Promise<void>;
}
