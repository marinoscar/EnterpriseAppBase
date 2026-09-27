import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { SettingsModule } from '../settings/settings.module';
import { GreptimeClient } from './greptime/greptime.client';
import { TelemetryRetentionHandler } from './handlers/telemetry-retention.handler';
import { TelemetryRetentionTask } from './tasks/telemetry-retention.task';
import { TelemetryAdminController } from './telemetry-admin.controller';
import { TelemetryConfigController } from './telemetry-config.controller';
import { TelemetrySettingsService } from './telemetry-settings.service';
import { TelemetryStatusService } from './telemetry-status.service';

// =============================================================================
// TelemetryModule (issue #534, epic #528)
// =============================================================================
//
// The API side of observability: the `telemetry` settings (and the runtime
// export gate they drive), the GreptimeDB client, the store's status, and the
// server-only `telemetry.retention.apply` job with its enqueue-only cron.
//
// EXTENSION POINTS for the stories that follow:
//   - #535 (explorer query/export): add a `TelemetryQueryService` here that
//     validates a single read-only statement, wraps it with the row cap from
//     `TelemetrySettingsService.getPolicy().query`, and runs it through
//     `GreptimeClient.queryReader(sql, { timeoutMs })`; its controller is gated
//     on `telemetry:query`.
//   - #536 (assistant): tools that call the same query service, so the
//     assistant is held to exactly the explorer's guard and bounds.
//
// `GreptimeClient` and `TelemetrySettingsService` are exported for them.
// =============================================================================

@Module({
  imports: [JobsModule, SettingsModule],
  controllers: [TelemetryAdminController, TelemetryConfigController],
  providers: [
    GreptimeClient,
    TelemetrySettingsService,
    TelemetryStatusService,
    TelemetryRetentionHandler,
    TelemetryRetentionTask,
  ],
  exports: [GreptimeClient, TelemetrySettingsService],
})
export class TelemetryModule {}
