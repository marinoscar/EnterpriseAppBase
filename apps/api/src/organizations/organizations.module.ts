import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationsService } from './organizations.service';
import { TenancyService } from './tenancy.service';

/**
 * Organizations (PP-6.1). Providers only: no controller until the admin API
 * (PP-6.8) and switch-org (PP-6.4).
 *
 * Tenancy mode (PP-6.2): `TenancyService`, the parsed `TENANCY_MODE` the
 * sign-in path asks, and the `tenancy.mode` doctor check.
 */
@Module({
  imports: [PrismaModule],
  providers: [OrganizationsService, TenancyService],
  exports: [OrganizationsService, TenancyService],
})
export class OrganizationsModule {}
