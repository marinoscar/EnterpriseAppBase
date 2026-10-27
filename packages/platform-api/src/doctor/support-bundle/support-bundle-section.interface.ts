// =============================================================================
// The support-bundle section contract (issue #772, PP-13.1)
// =============================================================================
//
// A SECTION is one capability's contribution to the support bundle
// (`GET /api/admin/doctor/support-bundle`): the Doctor report, the versions,
// a telemetry summary, an app's own facts. It mirrors a doctor check:
//
//   1. READ-ONLY, like a doctor check (rule 3 of `doctor-check.interface.ts`):
//      no writes, no jobs, no model calls, no "test" services. An audited
//      read the capability already performs (the telemetry dashboard's
//      `telemetry:dashboard` row) is fine; a new write is not.
//   2. ALLOWLIST, NEVER DENYLIST. `collect()` copies the fields it means to
//      send into a new object; it never spreads a service's response. The
//      section's `schema` is STRICT (`.strict()` objects), so a field nobody
//      chose fails the section closed (status `error`, data dropped) instead
//      of leaking.
//   3. NO SECRET MATERIAL, no personal data beyond counts. A central redaction
//      pass (`redact.ts`) runs over the whole bundle afterwards, but it is the
//      second line of defence, not the first.
//   4. BOUNDED. Each section runs under `timeoutMs` (default 10 s) and its
//      serialized data is capped at 512 KiB.
//
// Sections self-register with `SupportBundleRegistry` from `onModuleInit`,
// exactly as checks register with `DoctorCheckRegistry`.
// =============================================================================

import type { ZodType } from 'zod';

/**
 * What a section's `collect()` receives.
 *
 * @stability experimental
 */
export interface SupportBundleSectionContext {
  /** Who is downloading the bundle. For an audited read the section performs on their behalf; never copy it into the data. */
  readonly actorUserId: string;
  /** Every permission the caller holds. */
  readonly permissions: ReadonlySet<string>;
  /** When the bundle build started. Use it instead of `new Date()` so every section agrees. */
  readonly now: Date;
  /** Aborted when the section's timeout elapses. Pass it on to any I/O that accepts one. */
  readonly signal: AbortSignal;
}

/**
 * One section of the support bundle. Implement it in the module that owns the
 * capability, inject `SupportBundleRegistry` and call
 * `registry.register(this)` from `onModuleInit`.
 *
 * @typeParam T - the data the section returns, as its `schema` describes it.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export interface SupportBundleSection<T = unknown> {
  /** Unique across the application; the key of the section in the bundle (`'doctor'`, `'versions'`, `'telemetry'`). Lowercase letters, digits, `.`, `_` and `-`. */
  readonly id: string;
  /** Human label, for logs and docs. */
  readonly label: string;
  /**
   * A permission needed IN ADDITION to the route's own (`system_settings:read`
   * by default). A caller without it gets `{ status: 'omitted' }` for this
   * section.
   */
  readonly permission?: string;
  /** Strict schema (`.strict()` objects): an unexpected field fails the section closed. */
  readonly schema: ZodType<T>;
  /** Ceiling for `collect()`, in milliseconds. Default 10_000. */
  readonly timeoutMs?: number;
  /**
   * Gathers the section's data. READ-ONLY, like a doctor check: no writes, no
   * jobs, no model calls, no "test" services. Return
   * {@link SupportBundleOmission} (`omitSupportBundleSection(reason)`) when the
   * capability is off and there is nothing to collect.
   *
   * @param ctx - the caller, the build instant and the timeout signal.
   */
  collect(ctx: SupportBundleSectionContext): Promise<T | SupportBundleOmission>;
}

const OMISSION = Symbol.for('@marinoscar/platform/doctor/SupportBundleOmission');

/**
 * What `collect()` returns to say "nothing to collect" (the capability is
 * switched off or not configured). Build it with {@link omitSupportBundleSection}.
 *
 * @stability experimental
 */
export interface SupportBundleOmission {
  /** Brand; do not construct by hand. */
  readonly [OMISSION]: true;
  /** One line saying why, shown as the section's `reason`. */
  readonly reason: string;
}

/**
 * Marks a section as `omitted` from inside `collect()`.
 *
 * @param reason - one line saying why (`'telemetry is switched off'`).
 * @returns the omission marker to return from `collect()`.
 *
 * @example
 * ```ts
 * if (!policy.enabled) return omitSupportBundleSection('telemetry is switched off');
 * ```
 *
 * @stability experimental
 */
export function omitSupportBundleSection(reason: string): SupportBundleOmission {
  return Object.freeze({ [OMISSION]: true as const, reason });
}

/**
 * Whether `value` is the marker {@link omitSupportBundleSection} returns.
 *
 * @param value - what a section's `collect()` resolved with.
 * @returns `true` for an omission.
 *
 * @stability experimental
 */
export function isSupportBundleOmission(value: unknown): value is SupportBundleOmission {
  return typeof value === 'object' && value !== null && (value as Record<symbol, unknown>)[OMISSION] === true;
}

/**
 * Who is downloading the bundle, as the route resolves them from the request.
 *
 * @stability experimental
 */
export interface SupportBundlePrincipal {
  /** The caller's user id. Audited; never written into the bundle. */
  readonly userId: string;
  /** Every permission the caller holds. */
  readonly permissions: readonly string[];
}
