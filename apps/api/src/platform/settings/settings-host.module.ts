import { Global, Module } from '@nestjs/common';
import { SETTINGS_DATA, SETTINGS_PROFILE_IMAGES } from '@marinoscar/platform-api/settings';

import { SettingsDataAdapter } from './settings-data.adapter';
import { AppSettingsProfileImages } from './settings-profile-images.adapter';

// =============================================================================
// The settings slice's host ports, bound to the reference app (issue #733)
// =============================================================================
//
// Passed to `SettingsModule.forRoot({ imports: [SettingsHostModule] })`
// (./settings.config.ts). The database for the deployment-wide tables is
// core's `PLATFORM_PRISMA`, bound once by `platformHostModule`; the global
// `PrismaModule` provides both clients the adapters use, so this module
// imports nothing (the settings graph stays a leaf: storage, jobs and
// notifications all import it).
// =============================================================================

const PORTS = [
  { provide: SETTINGS_DATA, useClass: SettingsDataAdapter },
  { provide: SETTINGS_PROFILE_IMAGES, useClass: AppSettingsProfileImages },
];

@Global()
@Module({
  providers: PORTS,
  exports: PORTS.map((port) => port.provide),
})
export class SettingsHostModule {}
