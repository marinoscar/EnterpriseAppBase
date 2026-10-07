import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrincipalCacheModule } from '../auth/principal-cache/principal-cache.module';
import { OrganizationsService } from './organizations.service';
import { TenancyService } from './tenancy.service';
import { TenancyModeDoctorCheck } from './doctor/tenancy-mode.doctor-check';

/**
 * Organizations (PP-6.1). Providers only: no controller until the admin API
 * (PP-6.8); switch-org (PP-6.4) is `POST /api/auth/switch-org` in `AuthModule`.
 *
 * Tenancy mode (PP-6.2): `TenancyService`, the parsed `TENANCY_MODE` the
 * sign-in path asks, and the `tenancy.mode` doctor check.
 */
@Module({
  // PP-6.4 (#724): membership mutations invalidate the principal cache.
  imports: [PrismaModule, PrincipalCacheModule],
  providers: [OrganizationsService, TenancyService, TenancyModeDoctorCheck],
  exports: [OrganizationsService, TenancyService],
})
export class OrganizationsModule {}
