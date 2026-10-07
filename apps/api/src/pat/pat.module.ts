import { Global, Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { PrincipalCacheModule } from '../auth/principal-cache/principal-cache.module';
import { PatController } from './pat.controller';
import { PatService } from './pat.service';

@Global()
@Module({
  // #724: a PAT revoke invalidates the owner's cached principals.
  imports: [PrismaModule, PrincipalCacheModule],
  controllers: [PatController],
  providers: [PatService],
  exports: [PatService],
})
export class PatModule {}
