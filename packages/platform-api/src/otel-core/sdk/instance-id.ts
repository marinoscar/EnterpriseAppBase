// =============================================================================
// The telemetry instance identifier (issue #565; packaged by issue #700)
// =============================================================================
//
// WHAT IT IS, AND WHY IT IS NOT THE SERVICE NAME
// -----------------------------------------------------------------------------
//
// `service.name` (`service-name.ts`) says WHICH PROGRAM produced a span:
// `my-app-api`. It is fixed per deployment by `OTEL_SERVICE_NAME` and cannot
// change without a restart, because it lives on the SDK resource.
//
// `app.instance.id` says WHICH DEPLOYMENT OF THE APPLICATION produced it. Two
// forks of the template, or staging and production of one fork, can ship
// into one shared telemetry store, and without a label of their own their
// series and traces are indistinguishable. An administrator sets it at
// runtime (the reference app's `telemetry.instanceId` setting), and the
// telemetry gate stamps it on every exported batch.
//
// THE DEFAULT IS THE APP'S, RESOLVED ON EVERY CALL
// -----------------------------------------------------------------------------
//
// The stored setting is `null` until an administrator overrides it, and `null`
// means "follow the app's slug". Storing the slug literally on first write
// would freeze it: a fork renamed afterwards would keep reporting under the
// template's identity. The package knows no product identity, so the caller
// passes the slug (`apps/api/src/common/otel/telemetry-identity.ts` binds
// `APP_SLUG`).
//
// SAFE TO IMPORT BEFORE THE SDK STARTS: no side effects, no imports.
// =============================================================================

/**
 * The OTel resource attribute key the instance identifier is exported under.
 *
 * @stability stable
 */
export const ATTR_APP_INSTANCE_ID = 'app.instance.id';

/**
 * The instance identifier used when neither the administrator nor the caller
 * names one. The reference app always passes its `APP_SLUG`, so it never
 * exports this value.
 *
 * @stability experimental
 */
export const DEFAULT_INSTANCE_ID = 'unknown';

/**
 * The instance identifier telemetry is stamped with: `configured` (the
 * administrator's choice) when set, else `fallback`.
 *
 * An empty string is treated like `null`: a label of `""` would be worse than
 * the default in every backend.
 *
 * @param configured - The stored setting; `null`, `undefined` or `""` means "use the default".
 * @param fallback - The app's own default (its slug). Defaults to {@link DEFAULT_INSTANCE_ID}.
 * @returns The resolved identifier, never empty.
 *
 * @stability stable
 */
export function resolveTelemetryInstanceId(
  configured: string | null | undefined,
  fallback: string = DEFAULT_INSTANCE_ID,
): string {
  return configured || fallback || DEFAULT_INSTANCE_ID;
}
