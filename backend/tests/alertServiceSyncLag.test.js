import { jest } from '@jest/globals';

const logger = { info: jest.fn(), error: jest.fn() };
const gauge = { set: jest.fn() };
const queueMetrics = {
  getFailureRate: jest.fn(() => 0),
  getSuccessRate: jest.fn(() => 100),
  deadLetterCount: 0,
  totalJobs: 0,
  failedJobs: 0,
};

jest.unstable_mockModule('../lib/queueConfig.js', () => ({ queueMetrics }));
jest.unstable_mockModule('../config/logger.js', () => ({
  createModuleLogger: () => logger,
}));
jest.unstable_mockModule('../lib/metrics.js', () => ({ register: {} }));
jest.unstable_mockModule('prom-client', () => ({
  default: { Gauge: jest.fn(() => gauge) },
}));

const { monitorQueueHealth, recordSyncLagTelemetry } = await import('../services/alertService.js');

beforeEach(() => {
  jest.clearAllMocks();
});

describe('indexer sync-lag telemetry', () => {
  it('records normal lag as a structured, low-cardinality metric and log', async () => {
    await monitorQueueHealth();

    expect(gauge.set).toHaveBeenCalledWith({ status: 'normal' }, 0);
    expect(logger.info).toHaveBeenCalledWith({
      message: 'indexer_sync_lag_calculated',
      correlationId: 'indexer-sync-lag',
      lagMs: 0,
      thresholdMs: 30000,
      status: 'normal',
    });
  });

  it('classifies high lag without putting it in a metric label', () => {
    expect(recordSyncLagTelemetry(30001)).toBe(true);

    expect(gauge.set).toHaveBeenCalledWith({ status: 'high' }, 30001);
    expect(logger.info.mock.calls[0][0]).toMatchObject({ lagMs: 30001, status: 'high' });
    expect(gauge.set.mock.calls[0][0]).toEqual({ status: 'high' });
  });

  it('marks negative or non-finite lag invalid and emits no unsafe numeric value', () => {
    expect(recordSyncLagTelemetry(Number.NaN)).toBe(false);
    expect(gauge.set).toHaveBeenCalledWith({ status: 'invalid' }, 0);
    expect(logger.info.mock.calls[0][0]).toMatchObject({ lagMs: null, status: 'invalid' });

    expect(recordSyncLagTelemetry(-1)).toBe(false);
    expect(gauge.set).toHaveBeenLastCalledWith({ status: 'invalid' }, 0);
  });
});