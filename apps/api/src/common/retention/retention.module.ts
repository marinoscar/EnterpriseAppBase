import { Module } from '@nestjs/common';

import { JobsModule } from '../../jobs/jobs.module';
import { SettingsModule } from '../../platform/settings/settings.config';
import { AuditEventsPurgeHandler } from './audit-events-purge.handler';
import { RetentionPurgeTask } from './retention-purge.task';

// =============================================================================
// RetentionModule (#681, platform-packages PP-1.10)
// =============================================================================
//
// The daily, enqueue-only retention cron for the `retention` settings
// namespace, and the one purge handler with no feature module of its own
// (`audit.events.purge`: many modules write audit events, none owns the
// table). The other three handlers live with the tables they purge:
// `notifications.inbox.purge` and `notifications.deliveries.purge` in
// `NotificationsModule`, `ai.runs.purge` in `AiRuntimeModule`.
//
// `PrismaModule` is global; `JobsModule` provides `JobHandlerRegistry` and
// `JobsService`; `SettingsModule` provides `getRetentionPolicy()`. The same
// import set as `ai/usage/ai-usage.module.ts`.
// =============================================================================

@Module({
  imports: [JobsModule, SettingsModule],
  providers: [AuditEventsPurgeHandler, RetentionPurgeTask],
})
export class RetentionModule {}
