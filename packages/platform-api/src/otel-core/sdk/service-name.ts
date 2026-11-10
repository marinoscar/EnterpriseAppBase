// =============================================================================
// The OpenTelemetry service name, resolved in exactly one place (issue #343;
// packaged by issue #700)
// =============================================================================
//
// WHY ONE SHARED EXPRESSION RATHER THAN SEVERAL FALLBACKS
// -----------------------------------------------------------------------------
//
// Several surfaces name the service: the SDK resource (`initializeOtel`), the
// app's configuration, the `service` field of every log line, the `@Trace()`
// tracer, the AI adapters' spans. Before issue #343 each spelled the fallback
// out for itself, and one read nothing at all, so setting `OTEL_SERVICE_NAME`
// moved some of them and left the rest on the template's name: spans of one
// process landed under two services in the same backend.
//
// One call makes them agree by construction. The FALLBACK is the app's to
// give: the package knows no product identity (a slice never imports the
// app's `@app/shared`), so the reference app binds it once, to
// `${APP_SLUG}-api`, in `apps/api/src/common/otel/telemetry-identity.ts`, and
// every app surface calls that binding. A renamed fork therefore never keeps
// reporting as the template it was cloned from.
//
// SAFE TO IMPORT BEFORE THE SDK STARTS
// -----------------------------------------------------------------------------
//
// The `sdk` subpath is loaded first thing by the app, before Nest exists, and
// auto-instrumentation can only patch modules required AFTER `sdk.start()`.
// This module reads `process.env` and nothing else. Keep it that way.
// =============================================================================

/**
 * The service name OpenTelemetry's own SDK reports when nothing names the
 * service, used here when the caller passes no fallback either.
 *
 * @stability experimental
 */
export const DEFAULT_SERVICE_NAME = 'unknown_service:node';

/**
 * The service name this process reports to OpenTelemetry: `OTEL_SERVICE_NAME`
 * when set, else `fallback`.
 *
 * Resolved on every call rather than captured in a module-level constant, so a
 * test that sets `process.env.OTEL_SERVICE_NAME` is not defeated by whichever
 * module happened to be imported first.
 *
 * @param fallback - The app's own default, `${APP_SLUG}-api` in the reference
 *   app. Defaults to {@link DEFAULT_SERVICE_NAME}.
 * @returns The resolved service name, never empty.
 *
 * @example
 * ```ts
 * export const appServiceName = () => resolveServiceName(`${APP_SLUG}-api`);
 * ```
 *
 * @stability stable
 */
export function resolveServiceName(fallback: string = DEFAULT_SERVICE_NAME): string {
  return process.env.OTEL_SERVICE_NAME || fallback || DEFAULT_SERVICE_NAME;
}
