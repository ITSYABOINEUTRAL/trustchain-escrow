import { afterEach, jest } from '@jest/globals';

const workers = [];
const deadLetterQueue = { add: jest.fn().mockResolvedValue(undefined) };
const sendAlert = jest.fn().mockResolvedValue(undefined);

class MockWorker {
  constructor() {
    this.handlers = new Map();
    workers.push(this);
  }

  on(event, handler) {
    this.handlers.set(event, handler);
    return this;
  }
}

jest.unstable_mockModule('bullmq', () => ({ Worker: MockWorker }));
jest.unstable_mockModule('../lib/queueConfig.js', () => ({
  connection: {},
  stellarEventsQueue: {},
  deadLetterQueue,
  queueMetrics: {},
}));
jest.unstable_mockModule('../services/alertService.js', () => ({ sendAlert }));

const { createEventWorker } = await import('../services/eventWorker.js');

const failedHandler = () => {
  createEventWorker();
  return workers.at(-1).handlers.get('failed');
};

const makeJob = (id, attemptsMade = 3) => ({
  id,
  data: { event: { topic: ['safe-topic'] }, ledger: 42 },
  attemptsMade,
  opts: { attempts: 3 },
});

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => {});
  deadLetterQueue.add.mockResolvedValue(undefined);
  sendAlert.mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('event worker failure alerting', () => {
  it('alerts once when concurrent callbacks report the same exhausted job', async () => {
    const onFailed = failedHandler();
    const job = makeJob('concurrent-job');

    await Promise.all([
      onFailed(job, new Error('sensitive error detail')),
      onFailed(job, new Error('sensitive error detail')),
    ]);

    expect(deadLetterQueue.add).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledTimes(1);
    expect(sendAlert).toHaveBeenCalledWith({
      type: 'permanent_event_failure',
      severity: 'critical',
      message: 'Event processing failed after configured retries',
      metadata: { queue: 'stellar-events', attemptsMade: 3 },
    });
  });

  it('does not alert before retries are exhausted', async () => {
    const onFailed = failedHandler();

    await onFailed(makeJob('retrying-job', 2), new Error('retryable'));

    expect(deadLetterQueue.add).not.toHaveBeenCalled();
    expect(sendAlert).not.toHaveBeenCalled();
  });

  it('degrades gracefully when dead-letter enqueueing and alert delivery fail', async () => {
    deadLetterQueue.add.mockRejectedValueOnce(new Error('redis credential detail'));
    sendAlert.mockRejectedValueOnce(new Error('webhook secret detail'));
    const onFailed = failedHandler();

    await expect(onFailed(makeJob('degraded-job'), new Error('private error'))).resolves.toBeUndefined();
    expect(sendAlert).toHaveBeenCalledTimes(1);
  });

  it('allows a new alert after the retention window expires', async () => {
    const onFailed = failedHandler();
    const job = makeJob('expiring-job');

    await onFailed(job, new Error('first failure'));
    jest.useFakeTimers();
    try {
      jest.advanceTimersByTime(5 * 60 * 1000 + 1);
      await onFailed(job, new Error('later failure'));
    } finally {
      jest.useRealTimers();
    }

    expect(sendAlert).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest deduplication entry when the cache reaches its cap', async () => {
    const onFailed = failedHandler();
    const oldestJob = makeJob('bounded-cache-0');

    for (let index = 0; index < 1001; index++) {
      await onFailed(makeJob(`bounded-cache-${index}`), new Error('failure'));
    }
    await onFailed(oldestJob, new Error('failure'));

    expect(sendAlert).toHaveBeenCalledTimes(1002);
  });
});