import { Controller, Get, Inject, Type } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { TelemetryPublicConfigDto } from './dto/telemetry-config.dto';
import { TelemetrySettingsService } from './telemetry-settings.service';
import type { ResolvedTelemetryModuleOptions } from './telemetry.options';


// =============================================================================
// TelemetryConfigController — GET /api/telemetry/config (issue #534)
// =============================================================================
//
// `@Auth()` with NO permission, like `GET /api/ai/config`: the web app decides
// whether to render any telemetry surface (nav entries, the settings card's
// feature gate) from this answer, for every signed-in user. It carries three
// booleans and nothing else — no bounds, no provenance, no store details.
// =============================================================================

/**
 * Creates the `TelemetryConfigController` class for one set of module options: its routes
 * guarded by the app's access decorators (`options.host.access`).
 * `TelemetryModule.forRoot()` calls it.
 *
 * @param options - the resolved module options.
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createTelemetryConfigController(options: ResolvedTelemetryModuleOptions): Type<unknown> {
  const access = options.host.access;

  @ApiTags('Telemetry')
  @Controller('telemetry')
  class TelemetryConfigController {
    constructor(@Inject(TelemetrySettingsService) private readonly settings: TelemetrySettingsService) {}

    @Get('config')
    @(access.requireAuthenticated())
    @ApiOperation({
      summary: 'Get the telemetry capabilities of this deployment',
      description:
        'Whether a telemetry store is deployed (`available` — false when GreptimeDB is not ' +
        'configured), whether telemetry collection is switched on (`enabled`), and whether the ' +
        'telemetry assistant is switched on (`assistantEnabled`). Readable by any signed-in ' +
        'user; answers may lag an administrator\'s change by up to five seconds.',
    })
    @ApiResponse({ status: 200, description: 'The telemetry capabilities', type: TelemetryPublicConfigDto })
    async getConfig() {
      return this.settings.describePublic();
    }
  }

  return TelemetryConfigController;
}
