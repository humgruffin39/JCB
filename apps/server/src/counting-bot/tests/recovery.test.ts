import { describe, expect, it } from 'vitest';
import type { CountMessage } from '../counting/message.js';
import { ProcessingQueue } from '../counting/processingQueue.js';
import {
  fetchAllMessagesAfter,
  RecoveryBuffer,
  type MessagePageSource,
} from '../counting/recovery.js';
import { message } from './helpers.js';

class FakePageSource implements MessagePageSource {
  public constructor(private readonly messages: readonly CountMessage[]) {}

  public fetchAfter(afterMessageId: string): Promise<readonly CountMessage[]> {
    return Promise.resolve(
      this.messages.filter((item) => BigInt(item.id) > BigInt(afterMessageId)).slice(0, 100),
    );
  }

  public fetchLatest(beforeMessageId?: string): Promise<readonly CountMessage[]> {
    return Promise.resolve(
      this.messages
        .filter(
          (item) => beforeMessageId === undefined || BigInt(item.id) < BigInt(beforeMessageId),
        )
        .slice(-100)
        .reverse(),
    );
  }
}

describe('message recovery', () => {
  it('paginates all messages received while the bot was stopped', async () => {
    const messages = Array.from({ length: 205 }, (_, index) =>
      message({ id: String(101 + index), content: String(index + 1) }),
    );
    const recovered = await fetchAllMessagesAfter(new FakePageSource(messages), '100');
    expect(recovered).toHaveLength(205);
    expect(recovered[0]?.id).toBe('101');
    expect(recovered.at(-1)?.id).toBe('305');
  });

  it('merges gateway messages with recovery, removes duplicates, and orders by ID', async () => {
    const processed: string[] = [];
    const queue = new ProcessingQueue<CountMessage>((item) => {
      processed.push(item.id);
      return Promise.resolve();
    });
    const buffer = new RecoveryBuffer();
    buffer.ingest(message({ id: '103' }));
    buffer.ingest(message({ id: '102' }));

    const completions = buffer.release([message({ id: '101' }), message({ id: '102' })], queue);
    await Promise.all(completions);
    expect(processed).toEqual(['101', '102', '103']);
  });

  it('can recover from a null watermark when the channel was initially empty', async () => {
    const messages = Array.from({ length: 150 }, (_, index) =>
      message({ id: String(101 + index) }),
    );
    const recovered = await fetchAllMessagesAfter(new FakePageSource(messages), null);
    expect(recovered.map((item) => item.id)).toEqual(messages.map((item) => item.id));
  });
});
