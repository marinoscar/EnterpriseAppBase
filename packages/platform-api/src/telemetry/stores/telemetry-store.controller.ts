import { Body, Controller, Get, Headers, Inject, Put, Type } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ErrorDto } from '../../core/index';
import type { ResolvedTelemetryModuleOptions } from '../telemetry.options';
import { TELEMETRY_PERMISSIONS } from '../telemetry.permissions';
import { TelemetryStoreResponseDto, UpdateTelemetryStoreDto } from './dto/telemetry-store.dto';
import { TelemetryStoreSettingsService } from './telemetry-store-settings.service';

// =============================================================================
// TelemetryStoreController (PP-14.11)
// =============================================================================
//
//   GET /api/admin/telemetry/store   telemetry:read
//   PUT /api/admin/telemetry/store   telemetry:write   (If-Match optional -> 409)
//
// The same permission strings as the rest of the telemetry admin surface, so
// the one `telemetry` settings card covers it (CLAUDE.md, Settings UI Pattern
// rule 3).
// =============================================================================

/**
 * Creates the `TelemetryStoreController` class for one set of module options:
 * its routes guarded by the app's access decorators (`options.host.access`),
 * the caller resolved by `options.actorId`. `TelemetryModule.forRoot()` calls it.
 *
 * @param options - the resolved module options.
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createTelemetryStoreController(options: ResolvedTelemetryModuleOptions): Type<unknown> {
  const access = options.host.access;
  const ActorId = options.actorIdParam;

  @ApiTags('Telemetry')
  @Controller('admin/telemetry/store')
  class TelemetryStoreController {
    constructor(@Inject(TelemetryStoreSettingsService) private readonly settings: TelemetryStoreSettingsService) {}

    @Get()
    @(access.requirePermissions([TELEMETRY_PERMISSIONS.READ]))
    @ApiOperation({
      summary: 'Get the telemetry store and its settings (Admin only)',
      description:
        'The telemetry store this deployment uses (`active`, chosen in code by ' +
        '`TelemetryModule.forRoot({ store })`) and every registered one. For a store with a ' +
        'generated form, `descriptor` lists its non-secret fields and its write-only secrets ' +
        '(`hasValue` only, never a value) and `settings` holds the values in force. For the ' +
        'built-in GreptimeDB, `descriptor` is null: its connection is ' +
        '`/api/admin/telemetry/connection`. `ready` says whether the store is configured; `error` ' +
        'why it could not be built.',
    })
    @ApiResponse({ status: 200, description: 'The telemetry store', type: TelemetryStoreResponseDto })
    async getStore() {
      return this.settings.describeForAdmin();
    }

    @Put()
    @(access.requirePermissions([TELEMETRY_PERMISSIONS.WRITE]))
    @ApiOperation({
      summary: 'Save the telemetry store settings (Admin only)',
      description:
        'Merges `settings` over the stored ones (validated with the store\'s own schema) and ' +
        'stores `secrets` (encrypted; write-only; `null` or an empty string removes one). It takes ' +
        'effect on this instance immediately and on every other one within five seconds. Not ' +
        'available for the built-in GreptimeDB store (400): use `/api/admin/telemetry/connection`.',
    })
    @ApiHeader({
      name: 'If-Match',
      description:
        'Expected `version` of the stored settings, for optimistic concurrency (`0` asserts nothing ' +
        'is stored). Omit to write unconditionally.',
      required: false,
    })
    @ApiResponse({ status: 200, description: 'The saved telemetry store', type: TelemetryStoreResponseDto })
    @ApiResponse({ status: 400, description: 'Validation error, an undeclared secret, or the built-in store', type: ErrorDto })
    @ApiResponse({ status: 409, description: 'Version conflict', type: ErrorDto })
    async replaceStore(
      @Body() dto: UpdateTelemetryStoreDto,
      @ActorId() userId: string,
      @Headers('if-match') ifMatch?: string,
    ) {
      const parsed = ifMatch !== undefined ? Number.parseInt(ifMatch, 10) : NaN;

      return this.settings.update(dto, userId, Number.isInteger(parsed) ? parsed : undefined);
    }
  }

  return TelemetryStoreController;
}
