import { Global, Module } from '@nestjs/common';
import { PLATFORM_PRISMA } from '@marinoscar/platform-api/core';
import { SETTINGS_DATA, SETTINGS_PROFILE_IMAGES } from '@marinoscar/platform-api/settings';

import { PrismaService } from '../../prisma/prisma.service';
import { SettingsDataAdapter } from './settings-data.adapter';
import { AppSettingsProfileImages } from './settings-profile-images.adapter';

// =============================================================================
// The settings slice's host ports, bound to the reference app (issue #733)
// =============================================================================
//
// Passed to `SettingsModule.forRoot({ imports: [SettingsHostModule] })`
// (./settings.config.ts). The global `PrismaModule` provides both clients the
// adapters use, so this module imports nothing (the settings graph stays a
// leaf: storage, jobs and notifications all import it).
//
// `PLATFORM_PRISMA` too, as the same `PrismaService` `platformHostModule`
// binds it to: the settings services inject it, and a feature module's unit
// graph (`JobsModule` without the app root) reaches settings without the
// platform host. Before the move the services injected `PrismaService`
// directly, which the global `PrismaModule` always provided.
// =============================================================================

const PORTS = [
  { provide: PLATFORM_PRISMA, useExisting: PrismaService },
  { provide: SETTINGS_DATA, useClass: SettingsDataAdapter },
  { provide: SETTINGS_PROFILE_IMAGES, useClass: AppSettingsProfileImages },
];

@Global()
@Module({
  providers: PORTS,
  exports: PORTS.map((port) => port.provide),
})
export class SettingsHostModule {}
