import { Module } from '@nestjs/common';

import { AiModule } from '../ai/ai.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { JobsModule } from '../jobs/jobs.module';
import { SettingsModule } from '../settings/settings.module';
import { TelemetryAssistantController } from './assistant/telemetry-assistant.controller';
import { TelemetryAssistantService } from './assistant/telemetry-assistant.service';
import { TelemetryConnectionAdminService } from './connection/telemetry-connection-admin.service';
import { TelemetryConnectionTestService } from './connection/telemetry-connection-test.service';
import { TelemetryConnectionController } from './connection/telemetry-connection.controller';
import { TelemetryConnectionService } from './connection/telemetry-connection.service';
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
// The connection (#558): `TelemetryConnectionService` resolves the GreptimeDB
// connection at runtime — the one saved at /admin/settings/telemetry (a
// `telemetry_connection` system-settings row plus two passwords in the
// credential store, hence `CredentialsModule`), else the `GREPTIME_*`
// deployment default. `GreptimeClient` builds its pools from it and rebuilds
// them when it changes. `TelemetryConnectionController` is the admin surface.
//
// `GreptimeClient`, `TelemetrySettingsService` and the two query services are
// exported for it.
// =============================================================================

@Module({
  imports: [JobsModule, SettingsModule, AiModule, CredentialsModule],
  controllers: [
    TelemetryAdminController,
    TelemetryConfigController,
    TelemetryExplorerController,
    TelemetryAssistantController,
    TelemetryConnectionController,
  ],
  providers: [
    TelemetryConnectionService,
    TelemetryConnectionAdminService,
    TelemetryConnectionTestService,
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
