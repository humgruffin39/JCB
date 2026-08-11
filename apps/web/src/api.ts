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
  const response = await fetch(`${API_ORIGIN}${path}`, {
    ...init,
    credentials: 'include',
    headers,
  });
  const body = (await response.json()) as unknown;
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
    throw new Error(
      error.success ? error.data.error.message : `API error ${String(response.status)}`,
    );
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
  csrfRefreshPromise ??= fetch(`${API_ORIGIN}/api/v1/auth/csrf`, {
    credentials: 'include',
    headers: { accept: 'application/json' },
  })
    .then(async (response) => {
      if (!response.ok) throw new Error('Authentication required.');
      const body = (await response.json()) as ApiEnvelope<{ csrfToken: string }>;
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
