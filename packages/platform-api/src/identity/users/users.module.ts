import { PrincipalCacheModule } from '../auth/principal-cache/principal-cache.module';
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  // `UsersService.updateUserRoles` raises `security.role_changed` (#128).
  // Imported explicitly — NotificationsModule is not @Global — so every
  // feature able to send a notification shows up in a diff.
  // PrincipalCacheModule (PP-1.12, #683): `UsersService` invalidates principals.
  // The notifier (`IDENTITY_NOTIFIER`) is the app's global host port.
  imports: [PrincipalCacheModule],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
