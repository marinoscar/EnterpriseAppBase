import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { OrganizationsService } from './organizations.service';

/**
 * Organizations (PP-6.1). Providers only: no controller until the admin API
 * (PP-6.8) and switch-org (PP-6.4).
 */
@Module({
  imports: [PrismaModule],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
