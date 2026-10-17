export function readExportDeliveryConfig(env = process.env) {
  const retentionDays = Number(env.EXPORT_JOB_RETENTION_DAYS ?? 7);
  const maxPendingJobs = Number(env.EXPORT_MAX_PENDING_JOBS ?? 1000);
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
    throw new Error('EXPORT_JOB_RETENTION_DAYS must be an integer between 1 and 365');
  }
  if (!Number.isInteger(maxPendingJobs) || maxPendingJobs < 1) {
    throw new Error('EXPORT_MAX_PENDING_JOBS must be a positive integer');
  }
  return { retentionDays, maxPendingJobs };
}

export function isExpiredExportJob(job, now = Date.now(), retentionDays = 7) {
  const createdAt = new Date(job.createdAt).getTime();
  return Number.isFinite(createdAt) && createdAt + retentionDays * 86400000 <= now;
}
