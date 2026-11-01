import { AlertsModule as PlatformAlertsModule } from '@marinoscar/platform-api/alerts';

import { JobsModule } from '../jobs/jobs.config';
import { telemetryModule } from '../telemetry/telemetry.config';

// =============================================================================
// The reference app's alerts slice (#1047)
// =============================================================================
//
// Rules over telemetry metrics, worker-node events and fleet health, incidents
// and their notifications, under `/api/admin/alerts`. The manifest half lives
// where the other slices' does: the two email templates and the two events in
// `platform/notifications/notification.manifest.ts`, the `app.alerts.*` metrics
// in `common/otel/app-metric.manifest.ts`, the permissions in
// `app-registrations/permissions.ts`.
//
// The telemetry module is imported so the metric and verdict kinds can read the
// store; the webhook port (`ALERTS_WEBHOOK_EMITTER`) is not bound here.
// =============================================================================

/** The slice, mounted once in AppModule. */
export const alertsModule = PlatformAlertsModule.forRoot({ imports: [JobsModule, telemetryModule] });
