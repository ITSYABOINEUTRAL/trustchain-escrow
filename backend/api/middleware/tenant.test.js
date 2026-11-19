'use strict';

/**
 * Concurrency coverage for tenant resolution precedence.
 *
 * These tests exercise overlapping requests against the tenant middleware to
 * verify that precedence resolution is deterministic regardless of interleaving.
 */

const path = require('path');

const TENANT_MODULE = path.join(__dirname, 'tenant.js');

/**
 * Load the tenant middleware fresh for each test so module-level state (if any)
 * cannot leak between cases.
 */
function loadTenantModule() {
  jest.resetModules();
  // eslint-disable-next-line global-require, import/no-dynamic-require
  return require(TENANT_MODULE);
}

/**
 * Resolve the exported middleware function regardless of export shape
 * (module.exports = fn, module.exports.default, or a named export).
 */
function getTenantMiddleware(mod) {
  if (typeof mod === 'function') return mod;
  if (mod && typeof mod.default === 'function') return mod.default;
  if (mod && typeof mod.tenantMiddleware === 'function') return mod.tenantMiddleware;
  if (mod && typeof mod.resolveTenant === 'function') return mod.resolveTenant;
  throw new Error('Unable to locate tenant middleware export');
}

/**
 * Build a minimal Express-like request object.
 */
function makeReq({ headers = {}, hostname = 'example.com', params = {}, query = {} } = {}) {
  return {
    headers: { host: hostname, ...headers },
    hostname,
    params,
    query,
    get(name) {
      const key = String(name).toLowerCase();
      return this.headers[key];
    },
  };
}

/**
 * Build a minimal Express-like response object that records status/body.
 */
function makeRes() {
  const res = {
    statusCode: 200,
    body: undefined,
    headers: {},
    locals: {},
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    send(payload) {
      this.body = payload;
      return this;
    },
    setHeader(name, value) {
      this.headers[String(name).toLowerCase()] = value;
      return this;
    },
  };
  return res;
}

/**
 * Invoke the middleware and resolve with the resulting request/response.
 * Supports both sync and async middleware signatures.
 */
function runMiddleware(middleware, req, res) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const done = (err) => {
      if (settled) return;
      settled = true;
      if (err) reject(err);
      else resolve({ req, res });
    };

    try {
      const result = middleware(req, res, done);
      if (result && typeof result.then === 'function') {
        result.then(() => done(), done);
      } else if (middleware.length < 3) {
        // Middleware does not accept a next callback; settle on next tick.
        process.nextTick(() => done());
      }
    } catch (err) {
      done(err);
    }
  });
}

/**
 * Extract the resolved tenant identifier from a request after middleware runs.
 */
function resolvedTenant(req) {
  return (
    (req.tenant && (req.tenant.id || req.tenant.slug || req.tenant)) ||
    req.tenantId ||
    (req.locals && req.locals.tenant) ||
    undefined
  );
}

describe('tenant resolution precedence (concurrency)', () => {
  test('primary success path resolves the same tenant for a single request', async () => {
    const middleware = getTenantMiddleware(loadTenantModule());
    const req = makeReq({ headers: { 'x-tenant-id': 'acme' } });
    const res = makeRes();

    await runMiddleware(middleware, req, res);

    expect(resolvedTenant(req)).toBeDefined();
    expect(res.statusCode).toBeLessThan(400);
  });

  test('overlapping requests with distinct tenants resolve deterministically', async () => {
    const middleware = getTenantMiddleware(loadTenantModule());

    const tenants = ['acme', 'globex', 'initech', 'umbrella', 'hooli'];
    const requests = tenants.map((tenant) => {
      const req = makeReq({ headers: { 'x-tenant-id': tenant } });
      const res = makeRes();
      return runMiddleware(middleware, req, res).then(({ req: outReq }) => ({
        tenant,
        resolved: resolvedTenant(outReq),
      }));
    });

    const results = await Promise.all(requests);

    // Each request must resolve to its own tenant, never a sibling's.
    for (const { tenant, resolved } of results) {
      expect(resolved).toBeDefined();
      expect(String(resolved)).toContain(tenant);
    }

    // No cross-contamination between concurrent resolutions.
    const resolvedValues = results.map((r) => String(r.resolved));
    expect(new Set(resolvedValues).size).toBe(tenants.length);
  });

  test('repeated concurrent batches produce identical precedence outcomes', async () => {
    const middleware = getTenantMiddleware(loadTenantModule());

    const runBatch = () => {
      const tenants = ['acme', 'globex', 'acme', 'initech'];
      return Promise.all(
        tenants.map((tenant) => {
          const req = makeReq({ headers: { 'x-tenant-id': tenant } });
          const res = makeRes();
          return runMiddleware(middleware, req, res).then(({ req: outReq }) =>
            String(resolvedTenant(outReq))
          );
        })
      );
    };

    const first = await runBatch();
    const second = await runBatch();

    expect(second).toEqual(first);
  });

  test('missing tenant header does not resolve a tenant and does not throw', async () => {
    const middleware = getTenantMiddleware(loadTenantModule());
    const req = makeReq({ headers: {} });
    const res = makeRes();

    await expect(runMiddleware(middleware, req, res)).resolves.toBeDefined();

    // Either the middleware rejects the request or leaves the tenant unset;
    // it must never fabricate a tenant identifier.
    if (res.statusCode >= 400) {
      expect(res.body).toBeDefined();
    } else {
      expect(resolvedTenant(req)).toBeUndefined();
    }
  });

  test('conflicting tenant identifiers resolve by precedence, not arrival order', async () => {
    const middleware = getTenantMiddleware(loadTenantModule());

    const buildReq = (order) => {
      const headers = {};
      for (const [key, value] of order) headers[key] = value;
      return makeReq({ headers });
    };

    const orderA = [
      ['x-tenant-id', 'acme'],
      ['x-tenant-slug', 'globex'],
    ];
    const orderB = [
      ['x-tenant-slug', 'globex'],
      ['x-tenant-id', 'acme'],
    ];

    const reqA = buildReq(orderA);
    const reqB = buildReq(orderB);
    const resA = makeRes();
    const resB = makeRes();

    await Promise.all([
      runMiddleware(middleware, reqA, resA),
      runMiddleware(middleware, reqB, resB),
    ]);

    // Header insertion order must not change the resolved tenant.
    expect(String(resolvedTenant(reqA))).toBe(String(resolvedTenant(reqB)));
  });
});
