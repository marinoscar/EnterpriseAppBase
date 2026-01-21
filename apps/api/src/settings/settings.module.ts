import { Module } from '@nestjs/common';
import { UserSettingsController } from './user-settings/user-settings.controller';
import { UserSettingsService } from './user-settings/user-settings.service';

@Module({
  controllers: [UserSettingsController],
  providers: [UserSettingsService],
  exports: [UserSettingsService],
})
export class SettingsModule {}
