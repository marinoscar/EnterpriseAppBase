// =============================================================================
// The app's binding of the sharing slice's host ports (issue #728, PP-7.1)
// =============================================================================
//
//   SHARING_DATA           SharingDataAdapter (PrismaService.runInOrg, PrismaSystemService.runAsSystem)
//   SHARING_EVENT_BUS      the process's EVENT_BUS (global EventBusModule)
//   SHARING_EVENT_EMITTER  EventEmitter2 (EventEmitterModule.forRoot in app.module.ts)
//   SHARING_NOTIFIER       SharingNotifierAdapter (NotificationsService)
//   SHARING_TENANCY        TenancyService (the identity slice's OrganizationsModule)
//   SHARING_JOBS           SharingJobsAdapter (JobsService, JobHandlerRegistry; #729)
// =============================================================================

import { Module } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  SHARING_DATA,
  SHARING_EVENT_BUS,
  SHARING_EVENT_EMITTER,
  SHARING_JOBS,
  SHARING_NOTIFIER,
  SHARING_TENANCY,
} from '@marinoscar/platform-api/sharing';
import { OrganizationsModule, TenancyService } from '@marinoscar/platform-api/identity';

import { EVENT_BUS } from '../../common/event-bus/event-bus.interface';
import { JobsModule } from '../jobs/jobs.config';
import { NotificationsModule } from '../notifications/notifications.config';
import { SharingDataAdapter } from './sharing-data.adapter';
import { SharingJobsAdapter } from './sharing-jobs.adapter';
import { SharingNotifierAdapter } from './sharing-notifier.adapter';

@Module({
  imports: [NotificationsModule, OrganizationsModule, JobsModule],
  providers: [
    SharingDataAdapter,
    SharingNotifierAdapter,
    { provide: SHARING_DATA, useExisting: SharingDataAdapter },
    { provide: SHARING_EVENT_BUS, useExisting: EVENT_BUS },
    { provide: SHARING_EVENT_EMITTER, useExisting: EventEmitter2 },
    { provide: SHARING_NOTIFIER, useExisting: SharingNotifierAdapter },
    { provide: SHARING_TENANCY, useExisting: TenancyService },
    SharingJobsAdapter,
    { provide: SHARING_JOBS, useExisting: SharingJobsAdapter },
  ],
  exports: [SHARING_DATA, SHARING_EVENT_BUS, SHARING_EVENT_EMITTER, SHARING_NOTIFIER, SHARING_TENANCY, SHARING_JOBS],
})
export class SharingHostModule {}
