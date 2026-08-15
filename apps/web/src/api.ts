/// <reference types="vite/client" />

import {
  activityExchangeResponseSchema,
  apiErrorSchema,
  publicSettingsSchema,
  raceDetailSchema,
  resultResponseSchema,
  type ActivityExchangeRequest,
  type ActivityExchangeResponse,
} from '@jcb/contracts';
import { isDiscordActivityLaunch } from './activity-launch.js';
import { selectServerOffset } from './playback-clock.js';

const browserEnvironment: unknown = import.meta.env;
const activityProxy =
  typeof window !== 'undefined' && isDiscordActivityLaunch(window.location.search);
// Discord's URL mappings proxy these relative paths. Calling the public origin
// directly from the iframe would bypass that boundary and its session cookies.
const API_ORIGIN = activityProxy
  ? ''
  : readEnvironmentString(browserEnvironment, 'VITE_API_ORIGIN') || '';
const API_REQUEST_TIMEOUT_MS = 15_000;
export const EDGE_ORIGIN =
  (activityProxy ? '' : readEnvironmentString(browserEnvironment, 'VITE_EDGE_ORIGIN')) ||
  (import.meta.env.DEV ? API_ORIGIN : '');

export function apiAbsoluteUrl(path: string): string {
  return `${API_ORIGIN}${path}`;
}

export interface ApiEnvelope<Result> {
  readonly apiVersion: 'v1';
  readonly result: Result;
}

export class ApiRequestError extends Error {
  public readonly status: number;
  public readonly code: string | undefined;

  public constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = status;
    this.code = code;
  }
}

type AuthScope = 'race' | 'admin';

const csrfRefreshPromises = new Map<AuthScope, Promise<string>>();

const AUTH_ERROR_CODES = new Set([
  'AUTH_REQUIRED',
  'ADMIN_REQUIRED',
  'ADMIN_OAUTH_REQUIRED',
  'GUILD_MEMBERSHIP_REQUIRED',
  'CSRF_TOKEN_INVALID',
  'CSRF_TOKEN_REQUIRED',
]);

export async function apiRequest<Result>(path: string, init: RequestInit = {}): Promise<Result> {
  return apiRequestInternal<Result>(path, init, authScopeForPath(path), true);
}

async function apiRequestInternal<Result>(
  path: string,
  init: RequestInit,
  scope: AuthScope,
  allowCsrfRetry: boolean,
): Promise<Result> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const csrfToken = getCsrfToken(scope);
  if (csrfToken !== null) headers.set('x-csrf-token', csrfToken);
  const response = await fetchWithTimeout(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  const body = await readJsonBody(response);
  if (!response.ok) {
    const error = apiErrorSchema.safeParse(body);
    if (
      allowCsrfRetry &&
      error.success &&
      ['CSRF_TOKEN_INVALID', 'CSRF_TOKEN_REQUIRED'].includes(error.data.error.code)
    ) {
      if (getCsrfToken(scope) === csrfToken) await refreshCsrfToken(scope);
      return apiRequestInternal<Result>(path, init, scope, false);
    }
    const requestError = new ApiRequestError(
      error.success ? error.data.error.message : `API error ${String(response.status)}`,
      response.status,
      error.success ? error.data.error.code : undefined,
    );
    notifyAuthExpired(requestError);
    throw requestError;
  }
  if (
    typeof body !== 'object' ||
    body === null ||
    !('apiVersion' in body) ||
    body.apiVersion !== 'v1' ||
    !('result' in body)
  ) {
    throw new Error('API response contract is invalid.');
  }
  return body.result as Result;
}

export async function refreshCsrfToken(scope: AuthScope = 'race'): Promise<string> {
  const existingPromise = csrfRefreshPromises.get(scope);
  if (existingPromise !== undefined) return existingPromise;
  const endpoint = scope === 'admin' ? '/api/v1/auth/admin/csrf' : '/api/v1/auth/csrf';
  const currentToken = getCsrfToken(scope);
  const headers = new Headers({ accept: 'application/json' });
  if (currentToken !== null) headers.set('x-csrf-token', currentToken);
  const refreshPromise = fetchWithTimeout(`${API_ORIGIN}${endpoint}`, {
    credentials: 'include',
    cache: 'no-store',
    headers,
  })
    .then(async (response) => {
      const body = await readJsonBody(response);
      if (!response.ok) {
        const error = apiErrorSchema.safeParse(body);
        throw new ApiRequestError(
          error.success ? error.data.error.message : 'Authentication required.',
          response.status,
          error.success ? error.data.error.code : undefined,
        );
      }
      if (
        typeof body !== 'object' ||
        body === null ||
        !('apiVersion' in body) ||
        body.apiVersion !== 'v1' ||
        !('result' in body) ||
        typeof body.result !== 'object' ||
        body.result === null ||
        !('csrfToken' in body.result) ||
        typeof body.result.csrfToken !== 'string'
      ) {
        throw new ApiRequestError('API response contract is invalid.', response.status);
      }
      setCsrfToken(scope, body.result.csrfToken);
      return body.result.csrfToken;
    })
    .finally(() => {
      csrfRefreshPromises.delete(scope);
    });
  csrfRefreshPromises.set(scope, refreshPromise);
  return refreshPromise.catch((error: unknown) => {
    if (error instanceof ApiRequestError) notifyAuthExpired(error);
    throw error;
  });
}

export async function exchangeTicket(ticket: string): Promise<{
  readonly csrfToken: string;
  readonly raceId?: string;
  readonly edgeAccessToken?: string;
}> {
  const result = await apiRequest<{
    csrfToken: string;
    raceId?: string;
    edgeAccessToken?: string;
  }>('/api/v1/auth/tickets/exchange', {
    method: 'POST',
    body: JSON.stringify({ ticket }),
  });
  setCsrfToken('race', result.csrfToken);
  if (result.edgeAccessToken !== undefined && result.raceId !== undefined) {
    sessionStorage.setItem(`jcb.edge-token:${result.raceId}`, result.edgeAccessToken);
  }
  return result;
}

export type ActivityAuthorizationExchangeRequest = ActivityExchangeRequest;
export type ActivityAuthorizationExchangeResult = ActivityExchangeResponse;

export async function exchangeActivityAuthorization(
  request: ActivityAuthorizationExchangeRequest,
): Promise<ActivityAuthorizationExchangeResult> {
  const response = await apiRequest<unknown>('/api/v1/auth/activity/exchange', {
    method: 'POST',
    body: JSON.stringify(request),
  });
  const parsed = activityExchangeResponseSchema.safeParse(response);
  if (!parsed.success) {
    throw new ApiRequestError('API response contract is invalid.', 502, 'ACTIVITY_SESSION_INVALID');
  }
  const result = parsed.data;
  setCsrfToken('race', result.csrfToken);
  if (result.edgeAccessToken !== undefined) {
    sessionStorage.setItem(`jcb.edge-token:${result.raceId}`, result.edgeAccessToken);
  }
  return result;
}

export function getCsrfToken(scope: AuthScope): string | null {
  return sessionStorage.getItem(`jcb.csrf:${scope}`);
}

export function setCsrfToken(scope: AuthScope, token: string): void {
  sessionStorage.setItem(`jcb.csrf:${scope}`, token);
}

export function clearCsrfToken(scope: AuthScope): void {
  sessionStorage.removeItem(`jcb.csrf:${scope}`);
}

export async function getRace(raceId: string) {
  return raceDetailSchema.parse(
    await apiRequest<unknown>(`/api/v1/races/${encodeURIComponent(raceId)}`),
  );
}

export async function getResult(raceId: string) {
  return resultResponseSchema.parse(
    await apiRequest<unknown>(`/api/v1/races/${encodeURIComponent(raceId)}/result`),
  );
}

export async function getPublicSettings() {
  return publicSettingsSchema.parse(await apiRequest<unknown>('/api/v1/settings/public'));
}

export async function estimateServerOffset(): Promise<number> {
  const samples: Array<{ readonly rtt: number; readonly offset: number }> = [];
  for (let index = 0; index < 5; index += 1) {
    const started = performance.now();
    const localBefore = Date.now();
    const response = await apiRequest<{ epochMilliseconds: number }>('/api/v1/time');
    const rtt = performance.now() - started;
    const localMidpoint = localBefore + rtt / 2;
    samples.push({ rtt, offset: response.epochMilliseconds - localMidpoint });
  }
  return selectServerOffset(
    samples.map((sample) => ({
      roundTripMilliseconds: sample.rtt,
      offsetMilliseconds: sample.offset,
    })),
  );
}

function readEnvironmentString(environment: unknown, key: string): string {
  if (typeof environment !== 'object' || environment === null || !(key in environment)) {
    return '';
  }
  const value = (environment as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : '';
}

function authScopeForPath(path: string): AuthScope {
  return path.startsWith('/api/v1/admin/') ? 'admin' : 'race';
}

async function fetchWithTimeout(input: RequestInfo | URL, init: RequestInit): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort();
  if (init.signal?.aborted) {
    controller.abort();
  } else {
    init.signal?.addEventListener('abort', abortFromCaller, { once: true });
  }
  const timeout = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, API_REQUEST_TIMEOUT_MS);
  try {
    return await fetch(input, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new ApiRequestError('API request timed out.', 408, 'REQUEST_TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
    init.signal?.removeEventListener('abort', abortFromCaller);
  }
}

async function readJsonBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function notifyAuthExpired(error: ApiRequestError): void {
  if (
    typeof window !== 'undefined' &&
    error.code !== undefined &&
    AUTH_ERROR_CODES.has(error.code)
  ) {
    window.dispatchEvent(new Event('jcb:auth-expired'));
  }
}
