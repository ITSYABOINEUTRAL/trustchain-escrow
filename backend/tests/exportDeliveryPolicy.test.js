import { isExpiredExportJob, readExportDeliveryConfig } from '../lib/exportDeliveryPolicy.js';

test('validates export delivery settings', () => {
  expect(readExportDeliveryConfig({ EXPORT_JOB_RETENTION_DAYS: '30', EXPORT_MAX_PENDING_JOBS: '50' }))
    .toEqual({ retentionDays: 30, maxPendingJobs: 50 });
  expect(() => readExportDeliveryConfig({ EXPORT_JOB_RETENTION_DAYS: '0' })).toThrow(/RETENTION/);
  expect(() => readExportDeliveryConfig({ EXPORT_MAX_PENDING_JOBS: 'many' })).toThrow(/PENDING/);
});

test('expires jobs at the retention boundary', () => {
  const now = Date.parse('2026-01-08T00:00:00Z');
  expect(isExpiredExportJob({ createdAt: '2026-01-01T00:00:00Z' }, now, 7)).toBe(true);
  expect(isExpiredExportJob({ createdAt: 'invalid' }, now, 7)).toBe(false);
});
