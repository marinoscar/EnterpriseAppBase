// =============================================================================
// SharingModule.forRoot options (issue #728, PP-7.1): rung 1
// =============================================================================
//
// Merged over the defaults below and frozen. No environment variable: an app
// passes everything here (spec, "Configuration").
// =============================================================================

import { Logger, type ModuleMetadata } from '@nestjs/common';

import { definePlatformHost, type PlatformHost, type Principal } from '../core/index';

/**
 * Injection token of the resolved, frozen {@link ResolvedSharingModuleOptions}.
 *
 * @stability experimental
 */
export const SHARING_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/sharing/OPTIONS');

/**
 * The group options.
 *
 * @stability experimental
 */
export interface SharingGroupsOptions {
  /** Max groups one user may create per organization (abuse bound). Default 100. */
  maxGroupsPerCreator?: number;
  /** Max members per group. Default 1000. */
  maxMembersPerGroup?: number;
  /** Default invite lifetime in days; `null` = no expiry. Default 14. */
  inviteTtlDays?: number | null;
  /**
   * Accept matching pending invites automatically when a user signs up.
   * Default false. Status: experimental. A no-op (with a startup warning) until
   * the identity slice emits a user-created event.
   */
  autoAcceptInvitesOnSignup?: boolean;
  /**
   * How long a principal's group memberships are cached, in seconds; `0`
   * turns the cache off. Default 30, the principal cache's default
   * (`AUTH_PRINCIPAL_CACHE_TTL_SECONDS`); an app usually passes the same value.
   * Every membership change invalidates the entry here and, through the event
   * bus, on every other replica, so the TTL is only the backstop.
   */
  membershipCacheTtlSeconds?: number;
}

/**
 * The options of `SharingModule.forRoot`.
 *
 * @stability experimental
 */
export interface SharingModuleOptions {
  /** The app's access decorators (`definePlatformHost`): a group route is never public. */
  host: PlatformHost;
  /** Modules that provide the host ports (`SHARING_DATA`, and optionally the bus, emitter, notifier and tenancy). */
  imports?: ModuleMetadata['imports'];
  /** Group limits and behaviour. */
  groups?: SharingGroupsOptions;
  /**
   * Reads the caller's principal from the framework request. Default:
   * `request.principal` (set by the reference app's authentication guard).
   */
  principal?: (request: unknown) => Principal | undefined;
}

/**
 * The options after defaults, validated and frozen.
 *
 * @stability experimental
 */
export interface ResolvedSharingModuleOptions {
  /** The validated host. */
  readonly host: PlatformHost;
  /** The host-port modules. */
  readonly imports: NonNullable<ModuleMetadata['imports']>;
  /** Group limits and behaviour, every field set. */
  readonly groups: {
    /** Max groups one user may create per organization. */
    readonly maxGroupsPerCreator: number;
    /** Max members per group. */
    readonly maxMembersPerGroup: number;
    /** Invite lifetime in days, or `null` for no expiry. */
    readonly inviteTtlDays: number | null;
    /** Experimental; a no-op until the identity slice emits a user-created event. */
    readonly autoAcceptInvitesOnSignup: boolean;
    /** Membership cache TTL in seconds; `0` is off. */
    readonly membershipCacheTtlSeconds: number;
  };
  /** The principal resolver. */
  readonly principal: (request: unknown) => Principal | undefined;
}

/**
 * The defaults {@link resolveSharingModuleOptions} applies.
 *
 * @stability experimental
 */
export const SHARING_GROUP_DEFAULTS: ResolvedSharingModuleOptions['groups'] = Object.freeze({
  maxGroupsPerCreator: 100,
  maxMembersPerGroup: 1000,
  inviteTtlDays: 14,
  autoAcceptInvitesOnSignup: false,
  membershipCacheTtlSeconds: 30,
});

/**
 * The default principal resolver: `request.principal` when it is an object
 * with a string `userId`.
 *
 * @param request - the framework request.
 * @returns the principal, or `undefined`.
 *
 * @stability experimental
 */
export function defaultSharingPrincipal(request: unknown): Principal | undefined {
  if (request === null || typeof request !== 'object') return undefined;
  const principal = (request as { principal?: unknown }).principal;
  if (principal === null || typeof principal !== 'object') return undefined;
  return typeof (principal as { userId?: unknown }).userId === 'string' ? (principal as Principal) : undefined;
}

function fail(why: string): never {
  throw new Error(`SharingModule.forRoot: ${why}.`);
}

function positiveInteger(value: unknown, name: string, fallback: number, allowZero = false): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    fail(`\`groups.${name}\` must be ${allowZero ? 'a non-negative' : 'a positive'} integer, not ${JSON.stringify(value)}`);
  }
  return value;
}

/**
 * Validates `options` and applies the defaults.
 *
 * @param options - what the app passed to `forRoot`.
 * @returns the resolved, frozen options.
 * @throws Error naming the bad option.
 *
 * @stability experimental
 */
export function resolveSharingModuleOptions(options: SharingModuleOptions): ResolvedSharingModuleOptions {
  if (options === null || typeof options !== 'object') fail('options are required ({ host, imports })');
  if (!options.host) fail("`host` is required (the app's definePlatformHost(...)): a group route is never public");
  const host = definePlatformHost(options.host);
  const groups = options.groups ?? {};
  if (groups === null || typeof groups !== 'object') fail('`groups` must be an object');

  let inviteTtlDays: number | null = SHARING_GROUP_DEFAULTS.inviteTtlDays;
  if (groups.inviteTtlDays === null) inviteTtlDays = null;
  else if (groups.inviteTtlDays !== undefined) inviteTtlDays = positiveInteger(groups.inviteTtlDays, 'inviteTtlDays', 14);

  if (groups.autoAcceptInvitesOnSignup !== undefined && typeof groups.autoAcceptInvitesOnSignup !== 'boolean') {
    fail('`groups.autoAcceptInvitesOnSignup` must be a boolean');
  }
  const principal = options.principal ?? defaultSharingPrincipal;
  if (typeof principal !== 'function') fail('`principal` must be a function');

  const resolved: ResolvedSharingModuleOptions = {
    host,
    imports: [...(options.imports ?? [])],
    groups: Object.freeze({
      maxGroupsPerCreator: positiveInteger(groups.maxGroupsPerCreator, 'maxGroupsPerCreator', SHARING_GROUP_DEFAULTS.maxGroupsPerCreator),
      maxMembersPerGroup: positiveInteger(groups.maxMembersPerGroup, 'maxMembersPerGroup', SHARING_GROUP_DEFAULTS.maxMembersPerGroup),
      inviteTtlDays,
      autoAcceptInvitesOnSignup: groups.autoAcceptInvitesOnSignup ?? false,
      membershipCacheTtlSeconds: positiveInteger(
        groups.membershipCacheTtlSeconds,
        'membershipCacheTtlSeconds',
        SHARING_GROUP_DEFAULTS.membershipCacheTtlSeconds,
        true,
      ),
    }),
    principal,
  };

  if (resolved.groups.autoAcceptInvitesOnSignup) {
    // The identity slice emits no user-created event yet (#721, #727): there
    // is nothing to hook. Documented as experimental; a seam request tracks it.
    new Logger('SharingModule').warn(
      '`groups.autoAcceptInvitesOnSignup` is on, but the identity slice emits no user-created event yet: ' +
        'the option has no effect. Invitees accept their invites from GET /api/groups/invites/mine.',
    );
  }

  return Object.freeze(resolved);
}
