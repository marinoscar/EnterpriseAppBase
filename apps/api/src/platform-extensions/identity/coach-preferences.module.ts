import { Module } from '@nestjs/common';

import { CoachPreferencesController } from './coach-preferences.controller';
import { CoachPreferencesService } from './coach-preferences.service';

/**
 * EXAMPLE (PP-14.27): the module a fork imports next to `AppModule`'s other
 * feature modules to expose the coach preferences. `IdentityMetadataService`
 * needs no import: `IdentityModule` is global.
 */
@Module({ controllers: [CoachPreferencesController], providers: [CoachPreferencesService], exports: [CoachPreferencesService] })
export class CoachPreferencesModule {}
