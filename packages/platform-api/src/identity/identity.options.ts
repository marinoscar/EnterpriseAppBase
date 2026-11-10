// =============================================================================
// `IdentityModule.forRoot()` options (issue #727, PP-6.6)
// =============================================================================

import type { DynamicModule, ForwardReference, Type } from '@nestjs/common';

import type { PortBinding } from '../core/index';
import type { SignInPolicy } from './auth/sign-in-policy';
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
   * The app's sign-in policy (PP-14.9): consulted for every provider after the
   * allowlist and before any write, it can deny a sign-in with a reason or map
   * roles onto a new user. Bound HERE and not by providing
   * `IDENTITY_SIGNIN_POLICY` in an app module, which identity's internals would
   * never see. Default: none (every sign-in the allowlist admits is allowed).
   *
   * @example
   * ```ts
   * IdentityModule.forRoot({ signInPolicy: { useClass: CompanyDomainPolicy } });
   * ```
   */
  signInPolicy?: PortBinding<SignInPolicy>;
  /**
   * The device authorization flow (RFC 8628).
   */
  deviceFlow?: {
    /**
     * Custom URI schemes accepted in `clientInfo.returnUri` besides `https:`
     * (case-insensitive, without the colon), for an app that pairs a native
     * client. Default none: only `https:` return URIs are accepted. An Android
     * app passes its deep-link scheme, for example
     * `[androidIdentity(identity).deepLinkScheme]` from
     * `@marinoscar/platform-contract/android-app`.
     */
    returnUriSchemes?: readonly string[];
  };
  /**
   * The modules that bind identity's host ports (`IDENTITY_NOTIFIER`,
   * `USER_DEFAULTS`, `IDENTITY_JOBS`, `IDENTITY_NODE_CREDENTIALS`, ...). Each
   * must be `@Global()`: `JwtAuthGuard` is instantiated in every module whose
   * controllers use `@Auth()`, so the ports it needs must resolve there.
   */
  imports?: ReadonlyArray<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
}

/**
 * The device flow's options after defaults.
 *
 * @stability experimental
 */
export interface ResolvedDeviceFlowOptions {
  /** The accepted custom `returnUri` schemes, lower-cased, without the colon. */
  readonly returnUriSchemes: readonly string[];
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
  /** The app's sign-in policy binding, when one was given. */
  readonly signInPolicy?: PortBinding<SignInPolicy>;
  /** The device flow's resolved options. */
  readonly deviceFlow: ResolvedDeviceFlowOptions;
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
  deviceFlow: Object.freeze({ returnUriSchemes: Object.freeze([]) as readonly string[] }),
  imports: Object.freeze([]),
});

const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const SCHEME = /^[a-z][a-z0-9+.-]*$/;
const BLOCKED_RETURN_URI_SCHEMES: ReadonlySet<string> = new Set(['http', 'javascript', 'data', 'vbscript', 'file', 'blob', 'about']);
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
  const signInPolicy = options.signInPolicy;
  if (
    signInPolicy !== undefined &&
    !('useExisting' in signInPolicy || 'useClass' in signInPolicy || 'useFactory' in signInPolicy)
  ) {
    throw new Error('IdentityModule.forRoot: signInPolicy must be a binding: { useExisting }, { useClass } or { useFactory }.');
  }
  const returnUriSchemes = (options.deviceFlow?.returnUriSchemes ?? []).map((scheme) => scheme.trim().toLowerCase().replace(/:$/, ''));
  for (const scheme of returnUriSchemes) {
    if (!SCHEME.test(scheme) || BLOCKED_RETURN_URI_SCHEMES.has(scheme) || scheme === 'https') {
      throw new Error(
        `IdentityModule.forRoot: deviceFlow.returnUriSchemes entry ${JSON.stringify(scheme)} is not an accepted custom scheme ` +
          '(https is always accepted; http, javascript, data, vbscript, file and blob are refused).',
      );
    }
  }
  return Object.freeze({
    defaultOrgRole,
    initialAdminEmailEnv,
    enableTestAuth,
    ...(signInPolicy ? { signInPolicy } : {}),
    deviceFlow: Object.freeze({ returnUriSchemes: Object.freeze([...new Set(returnUriSchemes)]) }),
    imports: Object.freeze([...(options.imports ?? [])]),
  });
}
