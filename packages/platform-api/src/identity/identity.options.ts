// =============================================================================
// `IdentityModule.forRoot()` options (issue #727, PP-6.6)
// =============================================================================

import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';

import { DEFAULT_ORG_ROLE } from './identity.permissions';

/**
 * Injection token of the {@link ResolvedIdentityModuleOptions}, provided
 * globally by `IdentityModule.forRoot()`. Optional to every consumer: a graph
 * built without `forRoot` (a unit test) gets {@link DEFAULT_IDENTITY_OPTIONS}.
 *
 * @stability experimental
 */
export const IDENTITY_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/identity/OPTIONS');

/**
 * What an app passes to `IdentityModule.forRoot()`.
 *
 * @stability experimental
 */
export interface IdentityModuleOptions {
  /**
   * The org role a new membership gets: every sign-up's role in the default
   * organization and the role of an invitation that names none. Default
   * `'viewer'`. Must be a seeded org role.
   */
  defaultOrgRole?: string;
  /**
   * The environment variable (read through `ConfigService`) holding the address
   * that always bypasses the allowlist and becomes the first administrator.
   * Default `'INITIAL_ADMIN_EMAIL'`.
   */
  initialAdminEmailEnv?: string;
  /**
   * Mounts the test-only login (`POST /api/auth/test/login`,
   * `@marinoscar/platform-api/identity/testing`). Default `false`. Refused
   * (boot error) when `NODE_ENV` is `production`.
   */
  enableTestAuth?: boolean;
  /**
   * The modules that bind identity's host ports (`IDENTITY_NOTIFIER`,
   * `USER_DEFAULTS`, `IDENTITY_JOBS`, `IDENTITY_NODE_CREDENTIALS`, ...). Each
   * must be `@Global()`: `JwtAuthGuard` is instantiated in every module whose
   * controllers use `@Auth()`, so the ports it needs must resolve there.
   */
  imports?: ReadonlyArray<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

/**
 * The options after defaults, as `IDENTITY_OPTIONS` provides them.
 *
 * @stability experimental
 */
export interface ResolvedIdentityModuleOptions {
  /** The org role of a new membership. */
  readonly defaultOrgRole: string;
  /** The variable holding the initial administrator's address. */
  readonly initialAdminEmailEnv: string;
  /** Whether the test-only login is mounted. */
  readonly enableTestAuth: boolean;
  /** The host-port modules. */
  readonly imports: ReadonlyArray<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

/**
 * The options a graph without `forRoot` behaves as.
 *
 * @stability experimental
 */
export const DEFAULT_IDENTITY_OPTIONS: ResolvedIdentityModuleOptions = Object.freeze({
  defaultOrgRole: DEFAULT_ORG_ROLE,
  initialAdminEmailEnv: 'INITIAL_ADMIN_EMAIL',
  enableTestAuth: false,
  imports: Object.freeze([]),
});

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const ROLE_NAME = /^[a-z][a-z0-9_]*$/;

/**
 * Applies defaults and validates the options.
 *
 * @param options - the app's options.
 * @param nodeEnv - the environment (`process.env.NODE_ENV` by default), for the test-auth guard.
 * @returns the resolved, frozen options.
 * @throws Error naming the field when an option is invalid, or when
 *   `enableTestAuth` is requested in production.
 *
 * @stability experimental
 */
export function resolveIdentityModuleOptions(
  options: IdentityModuleOptions = {},
  nodeEnv: string | undefined = process.env.NODE_ENV,
): ResolvedIdentityModuleOptions {
  const defaultOrgRole = options.defaultOrgRole ?? DEFAULT_IDENTITY_OPTIONS.defaultOrgRole;
  if (!ROLE_NAME.test(defaultOrgRole)) {
    throw new Error(`IdentityModule.forRoot: defaultOrgRole ${JSON.stringify(defaultOrgRole)} is not a role name.`);
  }
  if (defaultOrgRole === 'admin') {
    throw new Error('IdentityModule.forRoot: defaultOrgRole cannot be "admin", a system role; use an org role such as "viewer".');
  }
  const initialAdminEmailEnv = options.initialAdminEmailEnv ?? DEFAULT_IDENTITY_OPTIONS.initialAdminEmailEnv;
  if (!ENV_NAME.test(initialAdminEmailEnv)) {
    throw new Error(
      `IdentityModule.forRoot: initialAdminEmailEnv ${JSON.stringify(initialAdminEmailEnv)} is not an environment variable name.`,
    );
  }
  const enableTestAuth = options.enableTestAuth ?? false;
  if (enableTestAuth && nodeEnv === 'production') {
    throw new Error(
      'IdentityModule.forRoot: enableTestAuth is refused in production. The test login issues a session for any ' +
        'address without a provider; pass enableTestAuth: process.env.NODE_ENV !== "production".',
    );
  }
  return Object.freeze({
    defaultOrgRole,
    initialAdminEmailEnv,
    enableTestAuth,
    imports: Object.freeze([...(options.imports ?? [])]),
  });
}
