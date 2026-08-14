import type { CountMessage } from './message.js';
import type { ProcessingQueue } from './processingQueue.js';
import { sortBySnowflake } from '../utilities/snowflake.js';

export interface MessagePageSource {
  fetchAfter(afterMessageId: string): Promise<readonly CountMessage[]>;
  fetchLatest(beforeMessageId?: string): Promise<readonly CountMessage[]>;
}

export async function fetchAllMessagesAfter(
  source: MessagePageSource,
  lastProcessedMessageId: string | null,
): Promise<CountMessage[]> {
  const byId = new Map<string, CountMessage>();

  if (lastProcessedMessageId === null) {
    let before: string | undefined;
    while (true) {
      const page = await source.fetchLatest(before);
      for (const message of page) {
        byId.set(message.id, message);
      }
      if (page.length < 100) {
        break;
      }

      const sortedPage = sortBySnowflake(page);
      const oldest = sortedPage[0];
      if (oldest === undefined || oldest.id === before) {
        throw new Error('Discord message pagination did not advance');
      }
      before = oldest.id;
    }
    return sortBySnowflake([...byId.values()]);
  }

  let cursor = lastProcessedMessageId;

  while (true) {
    const page = await source.fetchAfter(cursor);
    for (const message of page) {
      byId.set(message.id, message);
    }
    if (page.length < 100) {
      break;
    }

    const sortedPage = sortBySnowflake(page);
    const newest = sortedPage.at(-1);
    if (newest === undefined || newest.id === cursor) {
      throw new Error('Discord message pagination did not advance');
    }
    cursor = newest.id;
  }

  return sortBySnowflake([...byId.values()]);
}

export class RecoveryBuffer {
  private buffering = true;
  private accepting = true;
  private readonly messages = new Map<string, CountMessage>();

  public begin(): void {
    this.buffering = true;
  }

  public stopAccepting(): void {
    this.accepting = false;
  }

  public ingest(message: CountMessage, queue?: ProcessingQueue<CountMessage>): void {
    if (!this.accepting) {
      return;
    }
    if (this.buffering) {
      this.messages.set(message.id, message);
      return;
    }
    if (queue === undefined) {
      throw new Error('Live message queue is not initialized');
    }
    void queue.enqueue(message).catch(() => undefined);
  }

  public release(
    recoveredMessages: readonly CountMessage[],
    queue: ProcessingQueue<CountMessage>,
  ): Promise<void>[] {
    const combined = new Map<string, CountMessage>();
    for (const message of recoveredMessages) {
      combined.set(message.id, message);
    }
    for (const message of this.messages.values()) {
      combined.set(message.id, message);
    }
    this.messages.clear();

    const promises = queue.enqueueMany(sortBySnowflake([...combined.values()]));
    this.buffering = false;
    return promises;
  }
}
