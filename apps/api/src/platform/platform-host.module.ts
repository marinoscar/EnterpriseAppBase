// =============================================================================
// The app's DI-time platform ports (issue #696, PP-2.7)
// =============================================================================
//
// Imported ONCE, in `app.module.ts`. Global: every packaged slice injects
// `AUDIT_SINK`, `SYSTEM_SETTINGS_STORE` or `PLATFORM_PRISMA` by token and
// never imports an app service. `PrismaModule` is global already, so only the
// settings adapter's module needs listing.
// =============================================================================

import { PlatformHostModule } from '@marinoscar/platform-api/core';

import { PrismaService } from '../prisma/prisma.service';
import { SettingsModule } from './settings/settings.config';
import { PrismaAuditSink } from './audit-sink.adapter';
import { SystemSettingsStoreAdapter } from './system-settings-store.adapter';

export const platformHostModule = PlatformHostModule.forRoot({
  audit: { useClass: PrismaAuditSink },
  settings: { useClass: SystemSettingsStoreAdapter },
  prisma: { useExisting: PrismaService },
  imports: [SettingsModule],
});
