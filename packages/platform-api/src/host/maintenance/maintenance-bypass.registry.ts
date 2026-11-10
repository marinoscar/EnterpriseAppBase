// =============================================================================
// The maintenance bypass registry (PP-14.13)
// =============================================================================
//
// While a maintenance window is open, `MaintenanceGuard` answers 503 on every
// route except those marked `@AllowDuringMaintenance()` and, when
// `allowAdmins`, a request carrying a verified ADMIN session JWT. An app has
// requests that must get through anyway and that are neither: a payment
// provider's webhook that must not be lost, a partner's callback, a health
// check from a system the app does not control. `registerMaintenanceBypass`
// adds a predicate for them.
//
// FAIL CLOSED, and that is the contract:
//
//   * a predicate runs only for a request that is otherwise BLOCKED: never when
//     no window is open, never for a `@AllowDuringMaintenance()` route, and
//     never for a request the built-in admin rule already admitted (so a
//     predicate cannot change what an admin sees);
//   * only the value `true` allows. `false`, `undefined`, a truthy non-boolean,
//     a throw, a rejection and a predicate that does not settle within
//     {@link MAINTENANCE_BYPASS_TIMEOUT_MS} all mean "not bypassed";
//   * a predicate can only ADD an allowance. It cannot block a request the
//     built-in rule would admit, and it receives a read-only view of the
//     request, never the request itself;
//   * letting a request past the window is all it does. The route's own
//     `@Auth()` / signature check still runs, so a bypass for a webhook route
//     must be paired with a webhook that verifies its signature.
//
// The guard runs before any route guard, so `request.user` does not exist; the
// predicate gets the principal the guard itself can establish (a verified
// session JWT's subject and roles) and nothing else.
// =============================================================================

import { defineRegistry, type Registry } from '../../core/index';

/**
 * The id pattern of a maintenance bypass: lower-case, 2 to 48 characters,
 * starting with a letter (`payments-webhook`).
 *
 * @stability experimental
 */
export const MAINTENANCE_BYPASS_ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/;

/**
 * How long a predicate may take before it counts as "not bypassed".
 *
 * @stability experimental
 */
export const MAINTENANCE_BYPASS_TIMEOUT_MS = 1000;

/**
 * A frozen, read-only view of the request a predicate decides on.
 *
 * @stability experimental
 */
export interface MaintenanceBypassRequest {
  /** The HTTP method, upper-case. */
  readonly method: string;
  /** The URL path without the query string (`/api/webhooks/payments`). */
  readonly path: string;
  /** The request headers (lower-case names). A copy: changing it changes nothing. */
  readonly headers: Readonly<Record<string, string | string[] | undefined>>;
  /** The client address as the HTTP adapter reports it, when it does. */
  readonly ip: string | undefined;
}

/**
 * What the guard can establish about the caller before any route guard runs.
 *
 * @stability experimental
 */
export interface MaintenanceBypassPrincipal {
  /**
   * `session`: a bearer JWT that verified against the platform's secret
   * (`userId` and `roles` are its claims). `opaque`: a `pat_` or `nod_` bearer,
   * which is never resolved here. `anonymous`: no usable bearer.
   */
  readonly kind: 'session' | 'opaque' | 'anonymous';
  /** The verified subject of a `session`, else `null`. */
  readonly userId: string | null;
  /** The verified role ids of a `session`, else empty. */
  readonly roles: readonly string[];
}

/**
 * One maintenance bypass.
 *
 * @stability experimental
 */
export interface MaintenanceBypassDef {
  /** The id, for logs. See {@link MAINTENANCE_BYPASS_ID_PATTERN}. */
  readonly id: string;
  /**
   * Whether this otherwise-blocked request may proceed. Only `true` allows.
   * Keep it synchronous or very fast and free of I/O: it runs on the blocked
   * request path of every request while a window is open.
   *
   * @param request - a read-only view of the request.
   * @param principal - the caller as far as the guard can tell.
   * @returns `true` to let the request past the window.
   */
  allows(request: MaintenanceBypassRequest, principal: MaintenanceBypassPrincipal): boolean | Promise<boolean>;
}

/**
 * Every registered maintenance bypass, in registration order. Frozen when the
 * application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const maintenanceBypassRegistry: Registry<MaintenanceBypassDef> = defineRegistry<MaintenanceBypassDef>({
  name: 'host.maintenance-bypasses',
  idOf: (bypass) => bypass.id,
  idPattern: MAINTENANCE_BYPASS_ID_PATTERN,
  validate: (bypass) => {
    if (typeof bypass.allows !== 'function') {
      throw new Error(`maintenance bypass "${bypass.id}": allows must be a function`);
    }
  },
});

/**
 * Registers a maintenance bypass. Call it at module load, before the
 * application is created; a duplicate id throws.
 *
 * @param bypass - the bypass.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * // apps/api/src/app-registrations/host.ts
 * registerMaintenanceBypass({
 *   id: 'payments-webhook',
 *   allows: (request) => request.method === 'POST' && request.path === '/api/webhooks/payments',
 * });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerMaintenanceBypass(bypass: MaintenanceBypassDef): void {
  maintenanceBypassRegistry.register(bypass);
}
