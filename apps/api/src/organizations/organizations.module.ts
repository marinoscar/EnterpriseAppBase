import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrincipalCacheModule } from '../auth/principal-cache/principal-cache.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OrganizationsService } from './organizations.service';
import { TenancyService } from './tenancy.service';
import { TenancyModeDoctorCheck } from './doctor/tenancy-mode.doctor-check';
import { OrgMembersService } from './org-members.service';
import { OrgInvitesService } from './org-invites.service';
import { OrganizationsAdminService } from './organizations-admin.service';
import { OrgMembersController } from './org-members.controller';
import { OrgInvitesController } from './org-invites.controller';
import { OrganizationsAdminController } from './organizations-admin.controller';

/**
 * Organizations (PP-6.1). Switch-org (PP-6.4) is `POST /api/auth/switch-org`
 * in `AuthModule`.
 *
 * Tenancy mode (PP-6.2): `TenancyService`, the parsed `TENANCY_MODE` the
 * sign-in path asks, and the `tenancy.mode` doctor check.
 *
 * Org administration (PP-6.7, #726): the active organization's members
 * (`/api/org/members`) and invitations (`/api/org/invites`), and the
 * deployment's organizations (`/api/admin/organizations`).
 */
@Module({
  // PP-6.4 (#724): membership mutations invalidate the principal cache.
  // #726: invitations are emailed through the notification dispatcher.
  imports: [PrismaModule, PrincipalCacheModule, NotificationsModule],
  controllers: [OrgMembersController, OrgInvitesController, OrganizationsAdminController],
  providers: [
    OrganizationsService,
    TenancyService,
    TenancyModeDoctorCheck,
    OrgMembersService,
    OrgInvitesService,
    OrganizationsAdminService,
  ],
  exports: [OrganizationsService, TenancyService],
})
export class OrganizationsModule {}
