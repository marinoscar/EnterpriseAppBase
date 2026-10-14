import { Body, Controller, Get, Headers, Inject, Put, Type } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ErrorDto } from '../core/index';
import { TelemetryConfigResponseDto, UpdateTelemetryConfigDto } from './dto/telemetry-config.dto';
import { TelemetryStatusDto } from './dto/telemetry-status.dto';
import { TelemetrySettingsService } from './telemetry-settings.service';
import { TelemetryStatusService } from './telemetry-status.service';
import type { ResolvedTelemetryModuleOptions } from './telemetry.options';
import { TELEMETRY_PERMISSIONS } from './telemetry.permissions';

// =============================================================================
// TelemetryAdminController (issue #534, epic #528)
// =============================================================================
//
//   GET  /api/admin/telemetry/config   telemetry:read
//   PUT  /api/admin/telemetry/config   telemetry:write   (If-Match optional → 409)
//   GET  /api/admin/telemetry/status   telemetry:read
//
// The admin settings card for telemetry declares `telemetry:read` — the exact
// string enforced here (CLAUDE.md, Settings UI Pattern rule 3). Running SQL
// against the store is `telemetry:query` and lives in the explorer (#535),
// not here.
// =============================================================================

/**
 * Creates the `TelemetryAdminController` class for one set of module options: its routes
 * guarded by the app's access decorators (`options.host.access`), the caller
 * resolved by `options.actorId`. `TelemetryModule.forRoot()` calls it.
 *
 * @param options - the resolved module options.
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createTelemetryAdminController(options: ResolvedTelemetryModuleOptions): Type<unknown> {
  const access = options.host.access;
  const ActorId = options.actorIdParam;

  @ApiTags('Telemetry')
  @Controller('admin/telemetry')
  class TelemetryAdminController {
    constructor(
      @Inject(TelemetrySettingsService) private readonly settings: TelemetrySettingsService,
      @Inject(TelemetryStatusService) private readonly status: TelemetryStatusService,
    ) {}

    @Get('config')
    @(access.requirePermissions([TELEMETRY_PERMISSIONS.READ]))
    @ApiOperation({
      summary: 'Get the telemetry configuration (Admin only)',
      description:
        'The `telemetry` settings namespace — whether telemetry is exported, its retention, the ' +
        'bounds an ad-hoc query is held to, and the telemetry assistant — plus `available` ' +
        '(whether this deployment has a telemetry store at all), `retentionApplicable` (whether ' +
        'the store\'s admin credential is configured, which applying retention needs), ' +
        '`instanceIdDefault`/`instanceIdEffective` (what a null `instanceId` resolves to, and the ' +
        '`app.instance.id` label currently stamped on exported telemetry) and the settings row ' +
        '`version` to send back as `If-Match`.',
    })
    @ApiResponse({ status: 200, description: 'The telemetry configuration', type: TelemetryConfigResponseDto })
    async getConfig() {
      return this.settings.describeForAdmin();
    }

    @Put('config')
    @(access.requirePermissions([TELEMETRY_PERMISSIONS.WRITE]))
    @ApiOperation({
      summary: 'Replace the telemetry configuration (Admin only)',
      description:
        'Full replace of the `telemetry` namespace; `assistant.provider`/`assistant.modelId` sent ' +
        'as null clear a stored value. `instanceId` is optional: omitted keeps the stored value, ' +
        'null returns to the application-slug default, and a value (1-63 characters of `a-z`, ' +
        '`0-9`, `.`, `_`, `-`, starting with a letter or digit) becomes the `app.instance.id` ' +
        'resource attribute on every exported span, log record and metric. Export starts or ' +
        'stops, and a new instance id applies, immediately on this instance and within five ' +
        'seconds on every other one — no restart. Telemetry is only exported while ' +
        '`enabled` is true AND a telemetry store is configured.\n\n' +
        'Every save also queues a `telemetry.retention.apply` job, which sets the telemetry ' +
        'store\'s database TTL to `retentionDays` (the same job re-asserts it nightly).',
    })
    @ApiHeader({
      name: 'If-Match',
      description:
        'Expected `version` for optimistic concurrency (`0` asserts nothing is stored yet). ' +
        'Omit to overwrite unconditionally. This is the version of the whole system-settings ' +
        'row, so a concurrent save of an unrelated setting can cause a conflict — reload and ' +
        're-apply.',
      required: false,
    })
    @ApiResponse({ status: 200, description: 'The updated telemetry configuration', type: TelemetryConfigResponseDto })
    @ApiResponse({ status: 400, description: 'Validation error', type: ErrorDto })
    @ApiResponse({ status: 409, description: 'Version conflict', type: ErrorDto })
    async replaceConfig(
      @Body() dto: UpdateTelemetryConfigDto,
      @ActorId() userId: string,
      @Headers('if-match') ifMatch?: string,
    ) {
      // An unparseable `If-Match` is treated as absent, exactly as the AI and
      // storage admin controllers do.
      const parsed = ifMatch !== undefined ? Number.parseInt(ifMatch, 10) : NaN;
      const expectedVersion = Number.isInteger(parsed) ? parsed : undefined;

      return this.settings.replace(dto, userId, expectedVersion);
    }

    @Get('status')
    @(access.requirePermissions([TELEMETRY_PERMISSIONS.READ]))
    @ApiOperation({
      summary: 'Get the telemetry store status (Admin only)',
      description:
        'Whether the telemetry store (GreptimeDB) is configured and reachable, its version, the ' +
        'retention TTL currently in force, and its tables with row estimates. **Always 200**: an ' +
        'unconfigured or unreachable store is reported in `configured`, `reachable` and `error`, ' +
        'not as an error status.',
    })
    @ApiResponse({ status: 200, description: 'The telemetry store status', type: TelemetryStatusDto })
    async getStatus() {
      return this.status.getStatus();
    }
  }

  return TelemetryAdminController;
}
