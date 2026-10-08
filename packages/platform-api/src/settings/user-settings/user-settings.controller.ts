// =============================================================================
// `GET`, `PUT`, `PATCH /api/user-settings` (moved from the reference app, #733)
// =============================================================================
//
// Built by a factory for the reason `system-settings.controller.ts` gives: the
// optional namespaces of the bodies are composed from the user namespace
// registry, which the app fills before `SettingsModule.forRoot()` runs. Names,
// paths, permissions, bodies and envelope are unchanged.
// =============================================================================

import { Body, Controller, Get, Headers, Patch, Put, type Type } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';

import { Auth, CurrentUser } from '../../identity/index';
import {
  composePatchUserSettingsSchema,
  composeUpdateUserSettingsSchema,
  composeUserSettingsResponseSchema,
  type ComposedPatchUserBody,
  type ComposedUpdateUserBody,
} from '../registry/compose';
import { SETTINGS_PERMISSIONS } from '../settings.permissions';
import { UserSettingsService } from './user-settings.service';

/**
 * Builds the `/api/user-settings` controller and its three DTO classes from
 * the user namespace registry as it is now. Called by
 * `SettingsModule.forRoot()`; an app does not call it.
 *
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createUserSettingsController(): Type<unknown> {
  class UpdateUserSettingsDto extends createZodDto(composeUpdateUserSettingsSchema()) {}
  class PatchUserSettingsDto extends createZodDto(composePatchUserSettingsSchema()) {}
  class UserSettingsResponseDto extends createZodDto(composeUserSettingsResponseSchema()) {}

  @ApiTags('User Settings')
  @Controller('user-settings')
  class UserSettingsController {
    constructor(private readonly userSettingsService: UserSettingsService) {}

    @Get()
    @Auth({ permissions: [SETTINGS_PERMISSIONS.USER_SETTINGS_READ.id] })
    @ApiOperation({ summary: 'Get current user settings' })
    @ApiResponse({
      status: 200,
      description: 'User settings',
      type: UserSettingsResponseDto,
    })
    async getSettings(@CurrentUser('id') userId: string) {
      return this.userSettingsService.getSettings(userId);
    }

    @Put()
    @Auth({ permissions: [SETTINGS_PERMISSIONS.USER_SETTINGS_WRITE.id] })
    @ApiOperation({ summary: 'Replace user settings' })
    @ApiResponse({
      status: 200,
      description: 'Updated settings',
      type: UserSettingsResponseDto,
    })
    @ApiResponse({ status: 400, description: 'Validation error' })
    async replaceSettings(@CurrentUser('id') userId: string, @Body() dto: UpdateUserSettingsDto) {
      return this.userSettingsService.replaceSettings(userId, dto as unknown as ComposedUpdateUserBody);
    }

    @Patch()
    @Auth({ permissions: [SETTINGS_PERMISSIONS.USER_SETTINGS_WRITE.id] })
    @ApiOperation({ summary: 'Partially update user settings' })
    @ApiHeader({
      name: 'If-Match',
      description: 'Expected version for optimistic concurrency',
      required: false,
    })
    @ApiResponse({
      status: 200,
      description: 'Updated settings',
      type: UserSettingsResponseDto,
    })
    @ApiResponse({ status: 400, description: 'Validation error' })
    @ApiResponse({ status: 409, description: 'Version conflict' })
    async patchSettings(
      @CurrentUser('id') userId: string,
      @Body() dto: PatchUserSettingsDto,
      @Headers('if-match') ifMatch?: string,
    ) {
      const expectedVersion = ifMatch ? parseInt(ifMatch, 10) : undefined;
      return this.userSettingsService.patchSettings(userId, dto as unknown as ComposedPatchUserBody, expectedVersion);
    }
  }

  return UserSettingsController;
}
