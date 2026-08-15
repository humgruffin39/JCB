import type Database from 'better-sqlite3';

const ONE_DAY = 24 * 60 * 60 * 1_000;

export interface MaintenanceResult {
  readonly expiredInteractionSessions: number;
  readonly expiredLoginTickets: number;
  readonly expiredOAuthStates: number;
  readonly expiredWebSessions: number;
  readonly expiredActivitySessions: number;
  readonly expiredActivityLaunchIntents: number;
  readonly staleActivityInstances: number;
  readonly completedJobs: number;
  readonly completedPublications: number;
  readonly oldRankingSnapshots: number;
}

export class SqliteMaintenanceStore {
  public constructor(private readonly database: Database.Database) {}

  public cleanup(now: number): MaintenanceResult {
    const run = this.database.transaction((): MaintenanceResult => ({
      expiredInteractionSessions: this.database
        .prepare('DELETE FROM interaction_sessions WHERE expires_at < ?')
        .run(BigInt(now - ONE_DAY)).changes,
      expiredLoginTickets: this.database
        .prepare('DELETE FROM web_login_tickets WHERE expires_at < ?')
        .run(BigInt(now - ONE_DAY)).changes,
      expiredOAuthStates: this.database
        .prepare('DELETE FROM oauth_login_states WHERE expires_at < ?')
        .run(BigInt(now - ONE_DAY)).changes,
      expiredWebSessions: this.database
        .prepare(
          `DELETE FROM web_sessions
           WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`,
        )
        .run(BigInt(now - 30 * ONE_DAY), BigInt(now - 30 * ONE_DAY)).changes,
      expiredActivitySessions: this.database
        .prepare(
          `DELETE FROM activity_sessions
           WHERE expires_at < ? OR (revoked_at IS NOT NULL AND revoked_at < ?)`,
        )
        .run(BigInt(now - 30 * ONE_DAY), BigInt(now - 30 * ONE_DAY)).changes,
      expiredActivityLaunchIntents: this.database
        .prepare('DELETE FROM activity_launch_intents WHERE expires_at < ?')
        .run(BigInt(now - ONE_DAY)).changes,
      staleActivityInstances: this.database
        .prepare(
          `DELETE FROM activity_instances
           WHERE last_verified_at < ?
             AND NOT EXISTS (
               SELECT 1 FROM activity_sessions
               WHERE activity_sessions.instance_id = activity_instances.instance_id
             )`,
        )
        .run(BigInt(now - 30 * ONE_DAY)).changes,
      completedJobs: this.database
        .prepare("DELETE FROM scheduled_jobs WHERE status = 'completed' AND updated_at < ?")
        .run(BigInt(now - 30 * ONE_DAY)).changes,
      completedPublications: this.database
        .prepare(
          `DELETE FROM object_publications
           WHERE status = 'completed' AND updated_at < ?
             AND object_key NOT LIKE 'race-manifests/%'
             AND object_key NOT LIKE 'timelines/%'`,
        )
        .run(BigInt(now - 7 * ONE_DAY)).changes,
      oldRankingSnapshots: this.database
        .prepare('DELETE FROM ranking_snapshots WHERE calculated_at < ?')
        .run(BigInt(now - 180 * ONE_DAY)).changes,
    }));
    return run.immediate();
  }
}
