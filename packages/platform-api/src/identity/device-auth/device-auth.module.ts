import { Module } from '@nestjs/common';
import { DeviceAuthController } from './device-auth.controller';
import { DeviceAuthService } from './device-auth.service';
import { DeviceCodeCleanupTask } from './tasks/device-code-cleanup.task';
import { DeviceCodeCleanupHandler } from './handlers/device-code-cleanup.handler';

/**
 * Module for Device Authorization Flow (RFC 8628)
 *
 * Provides endpoints for:
 * - Generating device codes
 * - Polling for authorization status
 * - User authorization of devices
 * - Managing device sessions
 *
 * Mounted by `IdentityModule.forRoot()`; never import it directly.
 *
 * @stability experimental
 */
@Module({
  // `IdentityModule.forRoot()` imports the very AuthModule instance it
  // mounts (AuthService, JwtModule); the jobs port is the app's global host module.
  controllers: [DeviceAuthController],
  providers: [DeviceAuthService, DeviceCodeCleanupTask, DeviceCodeCleanupHandler],
  exports: [DeviceAuthService],
})
export class DeviceAuthModule {}
