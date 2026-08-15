import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  loadTimeline,
  readLimitedJsonStream,
  TimelineRequestError,
} from './race-timeline-loader.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

function chunkedStream(bytes: Uint8Array, splitAt = bytes.byteLength): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(0, splitAt));
      if (splitAt < bytes.byteLength) controller.enqueue(bytes.slice(splitAt));
      controller.close();
    },
  });
}

describe('readLimitedJsonStream', () => {
  it('parses JSON when a multi-byte character crosses chunk boundaries', async () => {
    const bytes = new TextEncoder().encode('{"name":"競馬"}');

    await expect(
      readLimitedJsonStream(chunkedStream(bytes, 10), bytes.byteLength),
    ).resolves.toEqual({
      name: '競馬',
    });
  });

  it('cancels the source and rejects before accepting data over the byte limit', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"frames":[]}'));
      },
      cancel() {
        cancelled = true;
      },
    });

    await expect(readLimitedJsonStream(stream, 4)).rejects.toThrow(
      'レース映像データのサイズが上限を超えています',
    );
    expect(cancelled).toBe(true);
  });

  it('rejects invalid JSON inside the limit', async () => {
    const bytes = new TextEncoder().encode('{');
    await expect(readLimitedJsonStream(chunkedStream(bytes), bytes.byteLength)).rejects.toThrow(
      SyntaxError,
    );
  });
});

describe('loadTimeline request errors', () => {
  it('preserves the retryable release status and code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            apiVersion: 'v1',
            error: { code: 'RACE_NOT_STARTED', message: 'not started' },
          }),
          { status: 425, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const error = await loadTimeline('race-1', 1, 'token').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(TimelineRequestError);
    expect(error).toMatchObject({
      status: 425,
      code: 'RACE_NOT_STARTED',
      message: '発走時刻前です',
    });
  });

  it('preserves a server status even when the error body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('upstream failed', { status: 503 })),
    );

    const error = await loadTimeline('race-1', 1, 'token').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(TimelineRequestError);
    expect(error).toMatchObject({
      status: 503,
      code: undefined,
      message: 'レース映像の解放情報を取得できません',
    });
  });
});
