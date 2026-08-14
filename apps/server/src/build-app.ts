import type { FastifyInstance } from 'fastify';
import { registerAdminHorseRoutes } from './admin-horse-routes.js';
import { registerAdminOperationsRoutes } from './admin-operations-routes.js';
import { registerAdminRaceRoutes } from './admin-race-routes.js';
import { registerAuthRoutes } from './auth-routes.js';
import { registerLocalEdgeRoutes } from './local-edge.js';
import { createServerRouteContext } from './server-context.js';
import { createServerApp, registerFoundationRoutes } from './server-foundation.js';
import { hashIp } from './server-support.js';
import type { ServerDependencies } from './server-types.js';
import { registerViewerRoutes } from './viewer-routes.js';

export type { ServerDependencies } from './server-types.js';
export { hashIp };

export async function buildServer(dependencies: ServerDependencies): Promise<FastifyInstance> {
  const app = await createServerApp(dependencies.environment);
  if (dependencies.timelineStore !== undefined) {
    registerLocalEdgeRoutes(app, {
      environment: dependencies.environment,
      clock: dependencies.clock,
      timelineStore: dependencies.timelineStore,
    });
  }
  const context = createServerRouteContext(app, dependencies, (error) =>
    app.log.error({ err: error }, 'Administrative notification failed after a committed mutation.'),
  );
  registerFoundationRoutes(app, context, dependencies);
  registerAuthRoutes(app, context);
  registerViewerRoutes(app, context);
  registerAdminHorseRoutes(app, context);
  registerAdminRaceRoutes(app, context);
  registerAdminOperationsRoutes(app, context);
  return app;
}
