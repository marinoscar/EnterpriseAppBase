// =============================================================================
// The reference app's binding of the host core (issue #867)
// =============================================================================
//
// `@marinoscar/platform-api/host` owns what used to be this app's own
// plumbing: the event bus, the platform's app metrics, maintenance mode (the
// platform's APP_GUARD), the `{ data }` envelope, the request log line, the
// exception filter and request ids. The app configures it here, once:
//
//   - the app-metric manifest runs FIRST, so the registry order stays the
//     platform's 31, the event bus's three, the slices' and then the app's
//     own (`APP_METRICS`), a collision naming the app;
//   - the settings manifest runs first too, so the `maintenance` namespace
//     keeps its place in the system settings document (`forRoot()` registers
//     it only when nothing did);
//   - the app's access decorators (`platformHost`) guard the maintenance routes;
//   - `EVENT_BUS_ADAPTER` and `OTEL_ENABLED` are read by the package itself
//     (the defaults), so there is nothing to pass; `EVENT_BUS_ADAPTER` accepts
//     any adapter registered in `app-registrations/host.ts` too.
//
// `app.module.ts` places `hostCoreModule` where `/api/health` used to be mounted:
// the generated OpenAPI document lists paths in module order, and
// `/api/admin/maintenance` has always followed `/api/health`.
//
// The OpenAPI identity (`APP_OPENAPI`) is bootstrap-time: `main.ts` passes it
// to `registerPlatformDocs`, the dump script and the tests to
// `createOpenApiDocument` (`../openapi/document.ts`).
// =============================================================================

import '../common/otel/app-metric.manifest';
// The settings manifest registers the `maintenance` namespace in this app's
// namespace order; `forRoot()` would otherwise register it itself.
import '../settings/registry';
// The app's own event bus adapters (PP-14.2), registered before `forRoot()` builds the bus.
import '../app-registrations/host';

import { PlatformHostCoreModule } from '@marinoscar/platform-api/host';

import { platformHost } from './platform-host';

// `host`: the maintenance routes and the health probes carry the app's own
// access decorators (`PlatformHost.access`), and the maintenance permissions
// default to `system_settings:read` / `system_settings:write`
// (`permissions: { maintenanceRead, maintenanceWrite }` changes them; the
// Maintenance settings card's `permission` must then change too).
export const hostCoreModule = PlatformHostCoreModule.forRoot({ host: platformHost });
