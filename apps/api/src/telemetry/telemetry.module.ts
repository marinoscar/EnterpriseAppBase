import { Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { SettingsModule } from '../settings/settings.module';
import { TelemetryExportService } from './export/telemetry-export.service';
import { GreptimeClient } from './greptime/greptime.client';
import { TelemetryRetentionHandler } from './handlers/telemetry-retention.handler';
import { TelemetryQueryService } from './query/telemetry-query.service';
import { TelemetrySchemaService } from './query/telemetry-schema.service';
import { TelemetryRetentionTask } from './tasks/telemetry-retention.task';
import { TelemetryAdminController } from './telemetry-admin.controller';
import { TelemetryConfigController } from './telemetry-config.controller';
import { TelemetryExplorerController } from './telemetry-explorer.controller';
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
// The explorer (#535): `TelemetryQueryService` (the one entry point for
// caller-supplied SQL: guard, row cap, timeout, audit), `TelemetrySchemaService`
// (tables and columns) and `TelemetryExportService` (csv/ndjson/xlsx/parquet),
// behind `TelemetryExplorerController` on `telemetry:query`.
//
// EXTENSION POINT: #536 (assistant) — tools call `TelemetryQueryService.run`
// with `source: 'assistant'`, so the assistant is held to exactly the
// explorer's guard and bounds, and `TelemetrySchemaService` to list and
// describe tables.
//
// `GreptimeClient`, `TelemetrySettingsService` and the two query services are
// exported for it.
// =============================================================================

@Module({
  imports: [JobsModule, SettingsModule],
  controllers: [TelemetryAdminController, TelemetryConfigController, TelemetryExplorerController],
  providers: [
    GreptimeClient,
    TelemetrySettingsService,
    TelemetryStatusService,
    TelemetryRetentionHandler,
    TelemetryRetentionTask,
    TelemetryQueryService,
    TelemetrySchemaService,
    TelemetryExportService,
  ],
  exports: [GreptimeClient, TelemetrySettingsService, TelemetryQueryService, TelemetrySchemaService],
})
export class TelemetryModule {}
