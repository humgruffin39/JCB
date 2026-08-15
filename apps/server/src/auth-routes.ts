import { createEdgeAccessToken, createOpaqueToken } from '@jcb/application';
import { discordOAuthCallbackSchema, ticketExchangeSchema } from '@jcb/contracts';
import { timestamp } from '@jcb/domain';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ACTIVITY_SESSION_COOKIE,
  ADMIN_SESSION_COOKIE,
  LEGACY_SESSION_COOKIE,
  RACE_SESSION_COOKIE,
  activitySessionTokenFromRequest,
  sessionTokenFromRequest,
} from './server-context.js';
import { envelope, httpError, oauthConfiguration } from './server-support.js';
import type { ServerRouteContext } from './server-types.js';

const OAUTH_STATE_COOKIE = 'jcb_oauth_state';
const ONE_DAY_MILLISECONDS = 24 * 60 * 60 * 1000;

export function registerAuthRoutes(app: FastifyInstance, context: ServerRouteContext): void {
  const { dependencies, now, authStore, activityStore, gameStore, viewerStore, authenticate } =
    context;

  app.post(
    '/api/v1/auth/tickets/exchange',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = ticketExchangeSchema.parse(request.body);
      let session;
      try {
        session = authStore.exchangeLoginTicket(body.ticket);
      } catch (error) {
        if (
          error instanceof Error &&
          /Login ticket is invalid|consumed concurrently/.test(error.message)
        ) {
          throw httpError(
            410,
            'LOGIN_TICKET_INVALID',
            'This Discord link has expired or was already used.',
          );
        }
        throw error;
      }
      if (!(await dependencies.membership.isCurrentMember(session.discordUserId))) {
        authStore.revoke(session.sessionToken);
        throw httpError(403, 'GUILD_MEMBERSHIP_REQUIRED', 'Current guild membership is required.');
      }
      setSessionCookie(
        reply,
        dependencies,
        RACE_SESSION_COOKIE,
        session.sessionToken,
        session.expiresAt,
      );
      let edgeAccessToken: string | undefined;
      if (
        session.raceId !== undefined &&
        dependencies.environment.EDGE_TOKEN_PRIVATE_KEY !== undefined &&
        dependencies.environment.DISCORD_GUILD_ID !== undefined
      ) {
        const race = viewerStore.getRaceDetail(session.raceId);
        edgeAccessToken = createEdgeAccessToken(
          {
            raceId: session.raceId,
            discordUserId: session.discordUserId,
            guildId: dependencies.environment.DISCORD_GUILD_ID,
            nbf: Math.floor(now() / 1000),
            exp: Math.floor((race.scheduledAt + ONE_DAY_MILLISECONDS) / 1000),
            jti: createOpaqueToken(),
          },
          dependencies.environment.EDGE_TOKEN_PRIVATE_KEY,
        );
      }
      return envelope({
        csrfToken: session.csrfToken,
        expiresAt: session.expiresAt,
        ...(session.raceId === undefined ? {} : { raceId: session.raceId }),
        ...(edgeAccessToken === undefined ? {} : { edgeAccessToken }),
      });
    },
  );

  app.get(
    '/api/v1/auth/discord/start',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const oauth = oauthConfiguration(dependencies.environment);
      const query = z
        .object({ reauthenticate: z.enum(['emergency']).optional() })
        .strict()
        .parse(request.query);
      const existingSession =
        query.reauthenticate === 'emergency'
          ? await authenticate(request, { admin: true })
          : undefined;
      const issued = authStore.issueOAuthState(
        existingSession === undefined ? 'login' : 'emergency_reauthentication',
        existingSession?.id,
      );
      const authorization = new URL('https://discord.com/oauth2/authorize');
      authorization.search = new URLSearchParams({
        response_type: 'code',
        client_id: oauth.clientId,
        redirect_uri: oauth.redirectUri,
        scope: 'identify',
        state: issued.state,
        code_challenge: createHash('sha256').update(issued.codeVerifier).digest('base64url'),
        code_challenge_method: 'S256',
        prompt: existingSession === undefined ? 'consent' : 'login',
      }).toString();
      reply.setCookie(OAUTH_STATE_COOKIE, issued.state, {
        path: '/api/v1/auth/discord/callback',
        httpOnly: true,
        secure: dependencies.environment.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 10 * 60,
      });
      return reply.redirect(authorization.toString());
    },
  );

  app.get(
    '/api/v1/auth/discord/callback',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const query = discordOAuthCallbackSchema.parse(request.query);
      const oauth = oauthConfiguration(dependencies.environment);
      if (request.cookies[OAUTH_STATE_COOKIE] !== query.state) {
        throw httpError(401, 'OAUTH_STATE_BROWSER_MISMATCH', 'Discord sign-in state is invalid.');
      }
      reply.clearCookie(OAUTH_STATE_COOKIE, { path: '/api/v1/auth/discord/callback' });
      let oauthState;
      try {
        oauthState = authStore.consumeOAuthState(query.state);
      } catch (error) {
        if (
          error instanceof Error &&
          /OAuth state is invalid|consumed concurrently/.test(error.message)
        ) {
          throw httpError(
            410,
            'OAUTH_STATE_INVALID',
            'This Discord sign-in link has expired or was already used.',
          );
        }
        throw error;
      }
      const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          code: query.code,
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
          redirect_uri: oauth.redirectUri,
          code_verifier: oauthState.codeVerifier,
        }),
      });
      if (!tokenResponse.ok) {
        throw httpError(401, 'DISCORD_OAUTH_EXCHANGE_FAILED', 'Discord sign-in failed.');
      }
      const token = z
        .object({ access_token: z.string().min(1), token_type: z.string().min(1) })
        .parse(await tokenResponse.json());
      const profileResponse = await fetch('https://discord.com/api/v10/users/@me', {
        headers: { authorization: `${token.token_type} ${token.access_token}` },
      });
      if (!profileResponse.ok) {
        throw httpError(401, 'DISCORD_PROFILE_FAILED', 'Discord profile could not be verified.');
      }
      const profile = z
        .object({
          id: z.string().regex(/^\d+$/),
          username: z.string().min(1).max(80),
          global_name: z.string().max(80).nullable().optional(),
        })
        .passthrough()
        .parse(await profileResponse.json());
      if (!(await dependencies.membership.isCurrentMember(profile.id))) {
        throw httpError(403, 'GUILD_MEMBERSHIP_REQUIRED', 'Current guild membership is required.');
      }
      gameStore.registerUser(profile.id, profile.global_name ?? profile.username, true);
      if (!authStore.isAdmin(profile.id)) {
        throw httpError(403, 'ADMIN_REQUIRED', 'Administrator access is required.');
      }
      if (
        oauthState.purpose === 'emergency_reauthentication' &&
        oauthState.existingSessionId !== undefined
      ) {
        authStore.markReauthenticated(oauthState.existingSessionId, profile.id, timestamp(now()));
        const destination = new URL('/admin', dependencies.environment.PUBLIC_WEB_ORIGIN);
        destination.searchParams.set('reauthenticated', 'emergency');
        return reply.redirect(destination.toString());
      }
      const session = authStore.createOAuthSession(profile.id);
      setSessionCookie(
        reply,
        dependencies,
        ADMIN_SESSION_COOKIE,
        session.sessionToken,
        session.expiresAt,
      );
      const destination = new URL('/admin', dependencies.environment.PUBLIC_WEB_ORIGIN);
      destination.hash = new URLSearchParams({ csrf: session.csrfToken }).toString();
      return reply.redirect(destination.toString());
    },
  );

  app.post('/api/v1/auth/logout', async (request, reply) => {
    const session = await authenticate(request, { csrf: true });
    if (session.authenticationMethod === 'activity') {
      const activityToken = activitySessionTokenFromRequest(request)!;
      activityStore.revoke(activityToken);
      expireActivityCookie(reply, dependencies);
      return envelope({ loggedOut: true });
    }
    const token = sessionTokenFromRequest(request, false)!;
    authStore.revoke(token);
    reply.clearCookie(RACE_SESSION_COOKIE, { path: '/' });
    reply.clearCookie(LEGACY_SESSION_COOKIE, { path: '/' });
    return envelope({ loggedOut: true });
  });

  app.get('/api/v1/auth/csrf', async (request, reply) => {
    const session = await authenticate(request);
    if (session.authenticationMethod === 'activity') {
      const sessionToken = activitySessionTokenFromRequest(request)!;
      reply.header('cache-control', 'no-store');
      return envelope({
        csrfToken: activityStore.getOrRotateCsrfToken(sessionToken, readCsrfHeader(request)),
      });
    }
    const sessionToken = sessionTokenFromRequest(request, false)!;
    reply.header('cache-control', 'no-store');
    return envelope({
      csrfToken: authStore.getOrRotateCsrfToken(sessionToken, readCsrfHeader(request)),
    });
  });

  app.get('/api/v1/auth/admin/csrf', async (request, reply) => {
    await authenticate(request, { admin: true });
    const sessionToken = sessionTokenFromRequest(request, true)!;
    const expiresAt = authStore.renewOAuthSession(sessionToken);
    if (expiresAt !== undefined) {
      setSessionCookie(reply, dependencies, ADMIN_SESSION_COOKIE, sessionToken, expiresAt);
    }
    reply.header('cache-control', 'no-store');
    return envelope({
      csrfToken: authStore.getOrRotateCsrfToken(sessionToken, readCsrfHeader(request)),
    });
  });
}

function expireActivityCookie(
  reply: FastifyReply,
  dependencies: ServerRouteContext['dependencies'],
): void {
  const attributes = [
    `${ACTIVITY_SESSION_COOKIE}=`,
    'Path=/',
    'HttpOnly',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'Max-Age=0',
  ];
  const clientId = dependencies.environment.DISCORD_CLIENT_ID;
  if (clientId !== undefined) {
    attributes.push(`Domain=${clientId}.discordsays.com`, 'Secure', 'SameSite=None', 'Partitioned');
  } else if (dependencies.environment.NODE_ENV !== 'production') {
    attributes.push('SameSite=Lax');
  } else {
    throw new Error('DISCORD_CLIENT_ID is not configured.');
  }
  reply.header('set-cookie', attributes.join('; '));
}

function setSessionCookie(
  reply: FastifyReply,
  dependencies: ServerRouteContext['dependencies'],
  cookieName: string,
  sessionToken: string,
  expiresAt: number,
): void {
  reply.setCookie(cookieName, sessionToken, {
    path: '/',
    httpOnly: true,
    secure: dependencies.environment.NODE_ENV === 'production',
    sameSite: dependencies.environment.NODE_ENV === 'production' ? 'none' : 'lax',
    expires: new Date(expiresAt),
  });
}

function readCsrfHeader(
  request: Parameters<ServerRouteContext['authenticate']>[0],
): string | undefined {
  const header = request.headers['x-csrf-token'];
  return Array.isArray(header) ? header[0] : header;
}
