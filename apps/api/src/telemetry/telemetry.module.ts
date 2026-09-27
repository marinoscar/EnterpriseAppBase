import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { JobsModule } from '../jobs/jobs.module';
import { SettingsModule } from '../settings/settings.module';
import { TelemetryAssistantController } from './assistant/telemetry-assistant.controller';
import { TelemetryAssistantService } from './assistant/telemetry-assistant.service';
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
// The assistant (#536): `TelemetryAssistantService` runs a text-to-SQL tool
// loop through `AiService` (hence `AiModule`); its tools call
// `TelemetryQueryService.run` with `source: 'assistant'`, so it is held to
// exactly the explorer's guard and bounds, and `TelemetrySchemaService` to
// list and describe tables. Streamed by `TelemetryAssistantController`.
//
// `GreptimeClient`, `TelemetrySettingsService` and the two query services are
// exported for it.
// =============================================================================

@Module({
  imports: [JobsModule, SettingsModule, AiModule],
  controllers: [
    TelemetryAdminController,
    TelemetryConfigController,
    TelemetryExplorerController,
    TelemetryAssistantController,
  ],
  providers: [
    GreptimeClient,
    TelemetrySettingsService,
    TelemetryStatusService,
    TelemetryRetentionHandler,
    TelemetryRetentionTask,
    TelemetryQueryService,
    TelemetrySchemaService,
    TelemetryExportService,
    TelemetryAssistantService,
  ],
  exports: [GreptimeClient, TelemetrySettingsService, TelemetryQueryService, TelemetrySchemaService],
})
export class TelemetryModule {}
