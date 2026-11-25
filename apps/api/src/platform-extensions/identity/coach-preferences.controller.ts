import { BadRequestException, Body, Controller, Get, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Auth, CurrentUser, MetadataError } from '@marinoscar/platform-api/identity';

import { CoachPreferencesService } from './coach-preferences.service';
import type { CoachPreferences } from './coach-preferences.metadata';

/**
 * EXAMPLE (PP-14.27): the app decides what to expose of a metadata namespace.
 * The platform serves no route over `users.metadata`; this controller returns
 * the one namespace it owns, for the signed-in user only. It is not mounted by
 * `AppModule`: `CoachPreferencesModule` is how a fork adds it.
 */
@ApiTags('Coach')
@Controller('coach/preferences')
export class CoachPreferencesController {
  constructor(private readonly preferences: CoachPreferencesService) {}

  @Get()
  @Auth()
  @ApiOperation({ summary: "The signed-in coach's preferences" })
  get(@CurrentUser('id') userId: string): Promise<CoachPreferences> {
    return this.preferences.get(userId);
  }

  @Put()
  @Auth()
  @ApiOperation({ summary: "Change the signed-in coach's preferences" })
  async put(@CurrentUser('id') userId: string, @Body() body: Partial<CoachPreferences>): Promise<CoachPreferences> {
    try {
      return await this.preferences.update(userId, body);
    } catch (error) {
      // INVALID_VALUE and SECRET_KEY are the caller's mistake; the rest is not.
      if (error instanceof MetadataError && (error.code === 'INVALID_VALUE' || error.code === 'SECRET_KEY' || error.code === 'TOO_LARGE')) {
        throw new BadRequestException(error.message);
      }
      throw error;
    }
  }
}
