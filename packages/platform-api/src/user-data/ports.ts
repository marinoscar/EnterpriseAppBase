// =============================================================================
// The user-data slice's host ports (issue #743, PP-9.1)
// =============================================================================
//
// Two capabilities the slice needs from the application, one injection token
// each; the app binds both in a `@Global()` module of its own (the reference
// app: `apps/api/src/platform/user-data/user-data-host.module.ts`).
//
// ⚠ THE PURGE RUNS ON THE BYPASS CLIENT. A user's rows live in every
// organization they belong to, and row-level security would hide every row
// outside the scope of a tenant client: a purge that silently deleted only the
// active organization's rows would report success. Every statement of the
// slice runs through `USER_DATA_DB` (reason `purge`, or `admin-aggregate` for
// the read-only summaries), with an explicit owner or organization filter.
//
// The tokens are `Symbol.for(...)` keys, so two copies of this file agree.
// =============================================================================

/**
 * Injection token of the app's {@link UserDataDbPort}.
 *
 * @extensionPoint token
 * @stability experimental
 * @example
 * ```ts
 * // UserDataHostModule: { provide: USER_DATA_DB, useClass: UserDataDbAdapter }
 * ```
 */
export const USER_DATA_DB: unique symbol = Symbol.for('@marinoscar/platform/user-data/DB');

/**
 * Why the slice lifts row-level security: deleting (`purge`) or counting
 * across organizations for a summary (`admin-aggregate`).
 *
 * @stability experimental
 */
export type UserDataSystemReason = 'purge' | 'admin-aggregate';

/**
 * The app's bypass client, as the user-data slice uses it. `tx` and the
 * client are the app's generated Prisma types, untyped here (the package
 * never sees the generated client).
 *
 * @stability experimental
 */
export interface UserDataDbPort {
  /**
   * One interactive transaction whose every statement lifts row-level security.
   *
   * @param reason - recorded on the active span.
   * @param fn - the work; `tx` is the transaction client.
   * @param options - `timeout` in milliseconds (a heavy user's purge outlives Prisma's 5 s default).
   */
  runAsSystem<R>(reason: UserDataSystemReason, fn: (tx: any) => Promise<R>, options?: { timeout?: number }): Promise<R>;
  /**
   * A client whose every single statement lifts row-level security (the
   * media step, which is not transactional, and the summaries).
   *
   * @param reason - recorded on the active span.
   */
  system(reason: UserDataSystemReason): any;
}

/**
 * Injection token of the app's {@link UserDataEnvironment}.
 *
 * @extensionPoint token
 * @stability experimental
 * @example
 * ```ts
 * // UserDataHostModule: { provide: USER_DATA_ENVIRONMENT, useClass: UserDataEnvironmentAdapter }
 * ```
 */
export const USER_DATA_ENVIRONMENT: unique symbol = Symbol.for('@marinoscar/platform/user-data/ENVIRONMENT');

/**
 * The two deployment facts the slice gates on: `DEPLOYMENT_MODE` (the factory
 * reset is disabled in `saas`) and `TENANCY_MODE` (offboarding needs `multi`).
 *
 * @stability experimental
 */
export interface UserDataEnvironment {
  /** `self-hosted` or `saas`. */
  deploymentMode(): 'self-hosted' | 'saas';
  /** `single` or `multi`. */
  tenancyMode(): 'single' | 'multi';
}
