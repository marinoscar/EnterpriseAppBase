// =============================================================================
// The reference app's bindings of the db-backup slice's host ports (issue #740)
// =============================================================================
//
// `@Global()`, passed to `DbBackupModule.forRoot({ imports })`
// (./db-backup.config.ts):
//
//   DB_BACKUP_NOTIFIER         -> NotificationsService   (the two db_backup.* events)
//   DB_BACKUP_MAINTENANCE      -> MaintenanceModeService (the swap's in-memory gate)
//   DB_BACKUP_METRICS          -> AppMetricsService      (the app.backup.* instruments)
//   DB_BACKUP_DEPLOYMENT_MODE  -> DeploymentModeService  (DEPLOYMENT_MODE, #685)
//   DB_BACKUP_SYSTEM_DATA      -> PrismaSystemService    (the Doctor's RLS count)
//
// The tenant client is the core port `PLATFORM_PRISMA` (`PlatformHostModule`,
// bound to `PrismaService`). This file is on the reviewed allowlist of
// `test/tenancy/system-injection-boundary.spec.ts`: the `backup.rls-bypass`
// Doctor check counts every organization's rows through the bypass client,
// under the `doctor` reason.
// =============================================================================

import { Global, Module } from '@nestjs/common';
import {
  DB_BACKUP_DEPLOYMENT_MODE,
  DB_BACKUP_MAINTENANCE,
  DB_BACKUP_METRICS,
  DB_BACKUP_NOTIFIER,
  DB_BACKUP_SYSTEM_DATA,
} from '@marinoscar/platform-api/db-backup';

import { DeploymentModeService } from '../../common/deployment/deployment-mode.service';
import { MaintenanceModeService } from '../../common/maintenance/maintenance-mode.service';
import { MaintenanceModule } from '../../common/maintenance/maintenance.module';
import { AppMetricsService } from '../../common/otel/app-metrics.service';
import { NotificationsModule } from '../../notifications/notifications.module';
import { NotificationsService } from '../../notifications/notifications.service';
import { PrismaSystemService } from '../../prisma/prisma-system.service';

const BINDINGS = [
  { provide: DB_BACKUP_NOTIFIER, useExisting: NotificationsService },
  { provide: DB_BACKUP_MAINTENANCE, useExisting: MaintenanceModeService },
  { provide: DB_BACKUP_METRICS, useExisting: AppMetricsService },
  { provide: DB_BACKUP_DEPLOYMENT_MODE, useExisting: DeploymentModeService },
  { provide: DB_BACKUP_SYSTEM_DATA, useExisting: PrismaSystemService },
];

@Global()
@Module({
  imports: [MaintenanceModule, NotificationsModule],
  providers: BINDINGS,
  exports: BINDINGS.map((binding) => binding.provide),
})
export class DbBackupHostModule {}
