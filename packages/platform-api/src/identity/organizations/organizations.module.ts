import { Global, Module } from '@nestjs/common';
import { PrincipalCacheModule } from '../auth/principal-cache/principal-cache.module';
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
 * deployment's organizations (`/api/admin/organizations`). Global; mounted by
 * `IdentityModule.forRoot()`.
 *
 * @stability experimental
 */
// GLOBAL (#727): `AuthService` and the test login use OrganizationsService and
// TenancyService without an import edge, so `IdentityModule.forRoot()` can mount
// it after the host modules (the app's old discovery order).
@Global()
@Module({
  // PP-6.4 (#724): membership mutations invalidate the principal cache.
  // #726: invitations are emailed through the notification dispatcher.
  // The database and the notifier are the app's global host ports.
  imports: [PrincipalCacheModule],
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
