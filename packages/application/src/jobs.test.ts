import { timestamp, type Timestamp } from '@jcb/domain';
import { runClaimedJob, type JobStore, type ScheduledJob } from './jobs.js';

const job: ScheduledJob = {
  id: 'job-1',
  jobType: 'backup_check',
  deduplicationKey: 'backup-check:test',
  payload: {},
  runAt: timestamp(1_000),
  status: 'running',
  attemptCount: 1,
};

function storeSpy() {
  const completions: Timestamp[] = [];
  const failures: Timestamp[] = [];
  const store: JobStore = {
    enqueue() {
      throw new Error('not used');
    },
    claimDue() {
      return undefined;
    },
    complete(_jobId, _workerId, at) {
      completions.push(at);
    },
    fail(_jobId, _workerId, at) {
      failures.push(at);
      return 'retry_wait';
    },
    reclaimStale() {
      return 0;
    },
  };
  return { store, completions, failures };
}

describe('claimed job execution', () => {
  it('records successful completion at the end of a long-running handler', async () => {
    let now = timestamp(1_000);
    const { store, completions } = storeSpy();

    await expect(
      runClaimedJob(
        store,
        {
          async backup_check() {
            now = timestamp(61_000);
          },
        },
        job,
        'worker-1',
        () => now,
      ),
    ).resolves.toBe('completed');

    expect(completions).toEqual([timestamp(61_000)]);
  });

  it('schedules failure handling from the actual failure time', async () => {
    let now = timestamp(1_000);
    const { store, failures } = storeSpy();

    await expect(
      runClaimedJob(
        store,
        {
          async backup_check() {
            now = timestamp(91_000);
            throw new Error('probe timed out');
          },
        },
        job,
        'worker-1',
        () => now,
      ),
    ).resolves.toBe('retry_wait');

    expect(failures).toEqual([timestamp(91_000)]);
  });
});
