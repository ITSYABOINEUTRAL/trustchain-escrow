# Tenant Audit Export Recovery

Detect queue growth, terminal job failures, and delivery latency above the configured objective. Validate retention and pending-job settings before restarting workers.

For mitigation, pause new large exports, preserve completed artifacts, and retry only jobs whose idempotency key has no successful delivery. Roll back the worker release if malformed artifacts or tenant leakage is observed.

Verify recovery with one small synchronous export, one queued export, one expired job cleanup, and a cross-tenant authorization rejection. Never include wallet addresses or export contents in operational logs.
