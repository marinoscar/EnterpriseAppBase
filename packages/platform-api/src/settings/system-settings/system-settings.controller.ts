// =============================================================================
// `GET`, `PUT`, `PATCH /api/system-settings` (moved from the reference app, #733)
// =============================================================================
//
// The request bodies are COMPOSED from the system namespace registry, so the
// controller is built by a factory that `SettingsModule.forRoot()` calls once,
// after the app registered its namespaces (an app's declarations cannot be
// known when this package is imported). The DTO and controller class names,
// the paths, the permissions, the bodies and the envelope are unchanged: the
// generated OpenAPI document is identical to the app's before the move.
//
// THE PATCH AND PUT BODIES ARE THE TRAP THE PARITY GUARD EXISTS FOR. The
// global `ZodValidationPipe` parses a body against them first and strips every
// key they do not declare, so a namespace missing here would be a SILENT
// no-op. Deriving them from the registry is what makes that impossible.
// =============================================================================

import { Body, Controller, Get, Headers, Patch, Put, type Type } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';

import { Auth, CurrentUser } from '../../identity/index';
import {
  composePatchSystemSettingsSchema,
  composeSystemSettingsResponseSchema,
  composeUpdateSystemSettingsSchema,
  type ComposedPatchBody,
  type ComposedUpdateBody,
} from '../registry/compose';
import { markSystemSettingsRequestBodiesComposed } from '../registry/system-settings-namespace';
import { SETTINGS_PERMISSIONS } from '../settings.permissions';
import { SystemSettingsService } from './system-settings.service';

/**
 * Builds the `/api/system-settings` controller and its three DTO classes from
 * the system namespace registry as it is now. Called by
 * `SettingsModule.forRoot()`; an app does not call it.
 *
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createSystemSettingsController(): Type<unknown> {
  markSystemSettingsRequestBodiesComposed();
  // Full replacement (PUT). A namespace with `requiredOnPut: false` may be
  // omitted: `SystemSettingsService.replaceSettings` carries it forward from
  // the stored value, never resetting it to the defaults.
  class UpdateSystemSettingsDto extends createZodDto(composeUpdateSystemSettingsSchema()) {}
  // Partial update (PATCH). Optional at the namespace level and field by field
  // inside, so `{ "databaseBackup": { "enabled": true } }` is a legal body.
  class PatchSystemSettingsDto extends createZodDto(composePatchSystemSettingsSchema()) {}
  class SystemSettingsResponseDto extends createZodDto(composeSystemSettingsResponseSchema()) {}

  @ApiTags('System Settings')
  @Controller('system-settings')
  class SystemSettingsController {
    constructor(private readonly systemSettingsService: SystemSettingsService) {}

    @Get()
    @Auth({ permissions: [SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_READ.id] })
    @ApiOperation({ summary: 'Get system settings (Admin only)' })
    @ApiResponse({
      status: 200,
      description: 'System settings',
      type: SystemSettingsResponseDto,
    })
    async getSettings() {
      return this.systemSettingsService.getSettings();
    }

    @Put()
    @Auth({ permissions: [SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_WRITE.id] })
    @ApiOperation({ summary: 'Replace system settings (Admin only)' })
    @ApiResponse({
      status: 200,
      description: 'Updated settings',
      type: SystemSettingsResponseDto,
    })
    @ApiResponse({ status: 400, description: 'Validation error' })
    async replaceSettings(@Body() dto: UpdateSystemSettingsDto, @CurrentUser('id') userId: string) {
      return this.systemSettingsService.replaceSettings(dto as unknown as ComposedUpdateBody, userId);
    }

    @Patch()
    @Auth({ permissions: [SETTINGS_PERMISSIONS.SYSTEM_SETTINGS_WRITE.id] })
    @ApiOperation({ summary: 'Partially update system settings (Admin only)' })
    @ApiHeader({
      name: 'If-Match',
      description: 'Expected version for optimistic concurrency',
      required: false,
    })
    @ApiResponse({
      status: 200,
      description: 'Updated settings',
      type: SystemSettingsResponseDto,
    })
    @ApiResponse({ status: 400, description: 'Validation error' })
    @ApiResponse({ status: 409, description: 'Version conflict' })
    async patchSettings(
      @Body() dto: PatchSystemSettingsDto,
      @CurrentUser('id') userId: string,
      @Headers('if-match') ifMatch?: string,
    ) {
      const expectedVersion = ifMatch ? parseInt(ifMatch, 10) : undefined;
      return this.systemSettingsService.patchSettings(dto as unknown as ComposedPatchBody, userId, expectedVersion);
    }
  }

  return SystemSettingsController;
}
