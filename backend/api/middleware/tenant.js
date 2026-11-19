import { createClient } from 'redis';

const TENANT_HEADER = 'x-tenant-id';
const TENANT_CACHE_PREFIX = 'tenant:';
const TENANT_CACHE_TTL_SECONDS = 300;

let redisClient = null;
let redisUnavailable = false;

function getRedisClient() {
  if (redisUnavailable) {
    return null;
  }

  if (redisClient) {
    return redisClient;
  }

  try {
    redisClient = createClient();
    redisClient.on('error', () => {
      // Optional infrastructure: degrade gracefully instead of crashing.
      redisUnavailable = true;
    });
    return redisClient;
  } catch {
    redisUnavailable = true;
    return null;
  }
}

async function readCachedTenant(tenantId) {
  const client = getRedisClient();
  if (!client) {
    return null;
  }

  try {
    const cached = await client.get(`${TENANT_CACHE_PREFIX}${tenantId}`);
    return cached ? JSON.parse(cached) : null;
  } catch {
    redisUnavailable = true;
    return null;
  }
}

async function writeCachedTenant(tenantId, tenant) {
  const client = getRedisClient();
  if (!client) {
    return;
  }

  try {
    await client.set(`${TENANT_CACHE_PREFIX}${tenantId}`, JSON.stringify(tenant), {
      EX: TENANT_CACHE_TTL_SECONDS,
    });
  } catch {
    redisUnavailable = true;
  }
}

function normalizeTenantId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Resolve the active tenant using a deterministic precedence order:
 *   1. Explicit tenant header (x-tenant-id)
 *   2. Cached tenant lookup (optional infrastructure)
 *   3. Default tenant fallback
 *
 * When optional infrastructure (Redis) is unavailable, resolution degrades
 * gracefully to the header/default paths without throwing.
 */
export async function resolveTenant(req) {
  const headerTenantId = normalizeTenantId(req?.headers?.[TENANT_HEADER]);

  if (headerTenantId) {
    const cached = await readCachedTenant(headerTenantId);
    const tenant = cached ?? { id: headerTenantId, source: 'header' };
    await writeCachedTenant(headerTenantId, tenant);
    return tenant;
  }

  return { id: null, source: 'default' };
}

export async function tenantMiddleware(req, res, next) {
  try {
    req.tenant = await resolveTenant(req);
    return next();
  } catch {
    // Never leak infrastructure details; return a stable degraded response.
    req.tenant = { id: null, source: 'degraded' };
    return next();
  }
}

export default tenantMiddleware;
