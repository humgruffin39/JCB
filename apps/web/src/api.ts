/// <reference types="vite/client" />

import {
  apiErrorSchema,
  publicSettingsSchema,
  raceDetailSchema,
  resultResponseSchema,
} from '@jcb/contracts';
import { selectServerOffset } from './playback-clock.js';

const browserEnvironment: unknown = import.meta.env;
const API_ORIGIN = readEnvironmentString(browserEnvironment, 'VITE_API_ORIGIN') || '';
const API_REQUEST_TIMEOUT_MS = 15_000;
export const EDGE_ORIGIN =
  readEnvironmentString(browserEnvironment, 'VITE_EDGE_ORIGIN') ||
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

let csrfRefreshPromise: Promise<string> | undefined;

export async function apiRequest<Result>(path: string, init: RequestInit = {}): Promise<Result> {
  return apiRequestInternal<Result>(path, init, true);
}

async function apiRequestInternal<Result>(
  path: string,
  init: RequestInit,
  allowCsrfRetry: boolean,
): Promise<Result> {
  const headers = new Headers(init.headers);
  headers.set('accept', 'application/json');
  if (init.body !== undefined) headers.set('content-type', 'application/json');
  const csrfToken = sessionStorage.getItem('jcb.csrf');
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
      if (sessionStorage.getItem('jcb.csrf') === csrfToken) await refreshCsrfToken();
      return apiRequestInternal<Result>(path, init, false);
    }
    const requestError = new ApiRequestError(
      error.success ? error.data.error.message : `API error ${String(response.status)}`,
      response.status,
      error.success ? error.data.error.code : undefined,
    );
    if (
      typeof window !== 'undefined' &&
      requestError.code !== undefined &&
      [
        'AUTH_REQUIRED',
        'ADMIN_REQUIRED',
        'GUILD_MEMBERSHIP_REQUIRED',
        'CSRF_TOKEN_INVALID',
        'CSRF_TOKEN_REQUIRED',
      ].includes(requestError.code)
    ) {
      window.dispatchEvent(new Event('jcb:auth-expired'));
    }
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

export async function refreshCsrfToken(): Promise<string> {
  csrfRefreshPromise ??= fetchWithTimeout(`${API_ORIGIN}/api/v1/auth/csrf`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
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
      sessionStorage.setItem('jcb.csrf', body.result.csrfToken);
      return body.result.csrfToken;
    })
    .finally(() => {
      csrfRefreshPromise = undefined;
    });
  return csrfRefreshPromise;
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
  sessionStorage.setItem('jcb.csrf', result.csrfToken);
  if (result.edgeAccessToken !== undefined && result.raceId !== undefined) {
    sessionStorage.setItem(`jcb.edge-token:${result.raceId}`, result.edgeAccessToken);
  }
  return result;
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
