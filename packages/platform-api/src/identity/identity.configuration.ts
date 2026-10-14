// =============================================================================
// Identity's deployment configuration (issue #727, PP-6.6)
// =============================================================================
//
// The environment variables identity reads, and the `ConfigService` keys it
// reads them under. `identityConfiguration()` builds those keys from
// `process.env`; the app spreads it into its own `ConfigModule.forRoot({ load })`
// factory (the reference app: `apps/api/src/config/configuration.ts`), so the
// keys and their defaults are defined once, here.
//
// Deploy-time secrets only (`JWT_SECRET`, `GOOGLE_CLIENT_SECRET`): runtime-
// configured features never get an environment variable.
//
// NO FALLBACK SECRET. A missing `JWT_SECRET` is a boot error
// (`requireJwtSecret`), never a hard-coded default: a public package must not
// ship a signing key anyone can read.
// =============================================================================

import type { ConfigService } from '@nestjs/config';

import { parsePrincipalCacheTtlSeconds } from './auth/principal-cache/principal-cache.config';
import { parseTenancyMode, type TenancyMode } from './organizations/tenancy-mode';

/**
 * The configuration identity reads, as `identityConfiguration()` builds it.
 * Each key is read with `ConfigService.get('<key>')`.
 *
 * @stability experimental
 */
export interface IdentityConfiguration {
  /** JWT signing and lifetimes (`JWT_SECRET`, `JWT_ACCESS_TTL_MINUTES`, `JWT_REFRESH_TTL_DAYS`). */
  jwt: {
    /** The HMAC signing secret. Required: identity refuses to boot without it. */
    secret: string | undefined;
    /** Access-token lifetime in minutes; 15 by default. */
    accessTtlMinutes: number;
    /** Refresh-token lifetime in days; 14 by default. */
    refreshTtlDays: number;
  };
  /** The principal cache (`AUTH_PRINCIPAL_CACHE_TTL_SECONDS`). */
  auth: {
    /** Seconds a validated principal is cached; 30 by default, 0 turns the cache off. */
    principalCacheTtlSeconds: number;
  };
  /** Google sign-in (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`). */
  google: {
    /** The OAuth client id. */
    clientId: string | undefined;
    /** The OAuth client secret. */
    clientSecret: string | undefined;
    /** The OAuth callback URL. */
    callbackUrl: string | undefined;
  };
  /** The address that always bypasses the allowlist and becomes the first administrator (`INITIAL_ADMIN_EMAIL`). */
  initialAdminEmail: string | undefined;
  /** The device authorization flow (`DEVICE_*`). */
  deviceAuth: {
    /** Lifetime of a device code in minutes; 15 by default. */
    expiryMinutes: number;
    /** Minimum polling interval in seconds; 5 by default. */
    pollInterval: number;
    /** Lifetime of a device session credential in days; 7 by default. */
    tokenExpiryDays: number;
    /** Lifetime of a device-issued personal access token in days; 90 by default. */
    patExpiryDays: number;
  };
  /** Tenancy (`TENANCY_MODE`): `single` (default) or `multi`. */
  tenancy: {
    /** The parsed mode; an invalid value throws at load. */
    mode: TenancyMode;
  };
}

/**
 * Builds identity's configuration keys from `env`. Spread it into the app's
 * configuration factory.
 *
 * @param env - the environment; `process.env` by default.
 * @returns the keys identity reads with `ConfigService.get`.
 * @throws Error when `TENANCY_MODE` is invalid (an invalid `AUTH_PRINCIPAL_CACHE_TTL_SECONDS` falls back to 30, with a warning).
 *
 * @example
 * ```ts
 * ConfigModule.forRoot({ load: [() => ({ ...identityConfiguration(), appUrl: process.env.APP_URL })] });
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export function identityConfiguration(env: NodeJS.ProcessEnv = process.env): IdentityConfiguration {
  return {
    jwt: {
      secret: env.JWT_SECRET,
      accessTtlMinutes: parseInt(env.JWT_ACCESS_TTL_MINUTES || '15', 10),
      refreshTtlDays: parseInt(env.JWT_REFRESH_TTL_DAYS || '14', 10),
    },
    auth: {
      principalCacheTtlSeconds: parsePrincipalCacheTtlSeconds(env.AUTH_PRINCIPAL_CACHE_TTL_SECONDS),
    },
    google: {
      clientId: env.GOOGLE_CLIENT_ID,
      clientSecret: env.GOOGLE_CLIENT_SECRET,
      callbackUrl: env.GOOGLE_CALLBACK_URL,
    },
    initialAdminEmail: env.INITIAL_ADMIN_EMAIL,
    deviceAuth: {
      expiryMinutes: parseInt(env.DEVICE_CODE_EXPIRY_MINUTES || '15', 10),
      pollInterval: parseInt(env.DEVICE_CODE_POLL_INTERVAL || '5', 10),
      tokenExpiryDays: parseInt(env.DEVICE_TOKEN_EXPIRY_DAYS || '7', 10),
      patExpiryDays: parseInt(env.DEVICE_PAT_EXPIRY_DAYS || '90', 10),
    },
    tenancy: {
      mode: parseTenancyMode(env.TENANCY_MODE),
    },
  };
}

/**
 * The JWT signing secret, or a boot error naming the variable. There is no
 * fallback: signing tokens with a key published in a package would let anyone
 * mint a session.
 *
 * @param config - the app's configuration (reads `jwt.secret`).
 * @returns the secret.
 * @throws Error when `JWT_SECRET` is unset or blank.
 *
 * @stability stable
 */
export function requireJwtSecret(config: Pick<ConfigService, 'get'>): string {
  const secret = config.get<string>('jwt.secret');
  if (typeof secret !== 'string' || secret.trim() === '') {
    throw new Error(
      'JWT_SECRET is not set. The API refuses to start without a JWT signing secret: there is no ' +
        'built-in fallback. Set JWT_SECRET to a long random value in the deployment environment ' +
        '(infra/compose/.env) and restart.',
    );
  }
  return secret;
}
