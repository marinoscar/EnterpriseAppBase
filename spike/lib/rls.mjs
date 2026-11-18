// The prototype RLS contract (#725): GUC names, policy template, and the three client shapes.
//
//   forScope(base, scope)          per-operation scoping (Prisma client extension). Each operation becomes
//                                  $transaction([ set_config(..., true), operation ]) on ONE connection.
//   runInScope(base, scope, fn)    one interactive transaction, set_config first, `fn` gets the UNEXTENDED tx.
//   systemClient(url)              a SEPARATE PrismaClient (its own pool) whose every operation sets
//                                  app.rls_bypass = 'on' transaction-locally.
//
// Nothing here ever uses a session-level SET: a transaction pooler (PgBouncer in transaction mode, RDS Proxy)
// may hand the next statement of the same client to a different server connection, and a session-level value
// would leak between requests.

import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

export const GUC = { org: 'app.org_id', user: 'app.user_id', bypass: 'app.rls_bypass' };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The policy template every org-owned table gets (a package migration emits this for each table). */
export function policySql(table, { orgColumn = 'org_id', policy = 'org_isolation' } = {}) {
  return `ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "${table}" FORCE ROW LEVEL SECURITY;
CREATE POLICY "${policy}" ON "${table}"
  USING (
    "${orgColumn}" = NULLIF(current_setting('${GUC.org}', true), '')::uuid
    OR current_setting('${GUC.bypass}', true) = 'on'
  );
`;
}

export function assertUuid(value, what) {
  if (typeof value !== 'string' || !UUID.test(value)) throw new Error(`${what} must be a UUID, got ${JSON.stringify(value)}`);
  return value;
}

/** One statement, one round trip, three transaction-local settings. */
export const setScopeSql = (base, { orgId, userId }) =>
  base.$executeRaw`SELECT set_config('app.org_id', ${assertUuid(orgId, 'orgId')}, true), set_config('app.user_id', ${userId ? assertUuid(userId, 'userId') : ''}, true)`;

export const setBypassSql = (base) => base.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;

/** Per-operation scoping. The extension runs on the BASE client; `query(args)` joins its batch. */
export function forScope(base, scope) {
  return base.$extends({
    name: 'platform-rls-scope',
    query: {
      async $allOperations({ args, query }) {
        const [, result] = await base.$transaction([setScopeSql(base, scope), query(args)]);
        return result;
      },
    },
  });
}

/** Same, for the system client: bypass instead of scope. */
export function forSystem(base) {
  return base.$extends({
    name: 'platform-rls-system',
    query: {
      async $allOperations({ args, query }) {
        const [, result] = await base.$transaction([setBypassSql(base), query(args)]);
        return result;
      },
    },
  });
}

/** One interactive transaction. `fn` receives the plain transaction client, never an extended one. */
export function runInScope(base, scope, fn, options) {
  return base.$transaction(async (tx) => {
    await setScopeSql(tx, scope);
    return fn(tx);
  }, options);
}

export function runAsSystem(base, fn, options) {
  return base.$transaction(async (tx) => {
    await setBypassSql(tx);
    return fn(tx);
  }, options);
}

export function makeClients({ clientModule, url, max = 5 }) {
  const { PrismaClient } = require(clientModule);
  const { PrismaPg } = require('@prisma/adapter-pg');
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max }) });
}
