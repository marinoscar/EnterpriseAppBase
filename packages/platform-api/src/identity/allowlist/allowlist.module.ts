import { Module } from '@nestjs/common';
import { AllowlistController } from './allowlist.controller';
import { AllowlistService } from './allowlist.service';

@Module({
  // `AllowlistService.addEmail` raises `allowlist.invitation` (#128).
  // The database (`PLATFORM_PRISMA`) and the notifier (`IDENTITY_NOTIFIER`)
  // are the app's global host ports.
  controllers: [AllowlistController],
  providers: [AllowlistService],
  exports: [AllowlistService],
})
export class AllowlistModule {}
