import { timestamp, type Clock, type Timestamp } from '@jcb/domain';

export class SystemClock implements Clock {
  public now(): Timestamp {
    return timestamp(Date.now());
  }
}
