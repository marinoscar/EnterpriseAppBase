// =============================================================================
// The one place a PostgreSQL connection string is built (issue #172; packaged
// by #740)
// =============================================================================
//
// DATABASE_URL is not a primary input in the platform: it is derived from the
// individual POSTGRES_* variables. Three hand-written copies of this
// derivation once disagreed about percent-encoding (a password containing `@`,
// `/` or `%` connected for migrations and then not for the application), which
// is why every caller goes through this function. The reference app's
// `common/database-url.ts` re-exports it, and its spec holds it together with
// the CommonJS copy in `apps/api/scripts/prisma-env.js` over a table of
// awkward inputs.
// =============================================================================

/**
 * The subset of the environment this builder reads.
 *
 * @stability stable
 */
export interface DatabaseEnv {
  /** An explicit connection string; wins untouched when set. */
  DATABASE_URL?: string | undefined;
  /** Host; default `localhost`. */
  POSTGRES_HOST?: string | undefined;
  /** Port; default `5432`. */
  POSTGRES_PORT?: string | undefined;
  /** Role; default `postgres`. Percent-encoded. */
  POSTGRES_USER?: string | undefined;
  /** Password; default `postgres`. Percent-encoded. */
  POSTGRES_PASSWORD?: string | undefined;
  /** Database; default `appdb`. */
  POSTGRES_DB?: string | undefined;
  /** Exactly `'true'` adds `?sslmode=require`. */
  POSTGRES_SSL?: string | undefined;
}

/**
 * Builds the PostgreSQL connection string.
 *
 * Two rules, both of which every caller now shares:
 *
 *  1. An already-set DATABASE_URL WINS and is returned untouched. It is the
 *     escape hatch for a connection this formula cannot express — a socket
 *     path, a pgbouncer URL, extra query parameters — and re-deriving over the
 *     top of it would silently discard the operator's intent.
 *  2. The user and the password are BOTH percent-encoded. The password is the
 *     one that bites in practice, but a username can contain `@` too, and
 *     encoding only one of them is how this class of bug comes back.
 *
 * @stability stable
 */
export function buildDatabaseUrl(env: DatabaseEnv = process.env): string {
  const existing = env.DATABASE_URL;
  if (existing !== undefined && existing !== '') {
    return existing;
  }

  const host = env.POSTGRES_HOST || 'localhost';
  const port = env.POSTGRES_PORT || '5432';
  const user = env.POSTGRES_USER || 'postgres';
  const password = env.POSTGRES_PASSWORD || 'postgres';
  const database = env.POSTGRES_DB || 'appdb';

  // Exact string comparison, deliberately: 'TRUE', '1' and 'yes' are NOT true
  // here, because that is the rule the other two builders already used and
  // widening it would change the meaning of existing .env files.
  const ssl = env.POSTGRES_SSL === 'true';
  const sslParam = ssl ? '?sslmode=require' : '';

  const encodedUser = encodeURIComponent(user);
  const encodedPassword = encodeURIComponent(password);

  return `postgresql://${encodedUser}:${encodedPassword}@${host}:${port}/${database}${sslParam}`;
}
