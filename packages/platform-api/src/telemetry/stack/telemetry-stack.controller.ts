import { Controller, Get, HttpCode, HttpStatus, Inject, Post, Type } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ErrorDto } from '../../core/index';
import { TelemetryStackDeployStartedDto, TelemetryStackStatusDto } from './dto/telemetry-stack.dto';
import { TelemetryStackService } from './telemetry-stack.service';
import type { ResolvedTelemetryModuleOptions } from '../telemetry.options';
import { TELEMETRY_HOST_PERMISSIONS } from '../telemetry.permissions';

// =============================================================================
// TelemetryStackController (issue #567, epic #528)
// =============================================================================
//
//   GET  /api/admin/telemetry/stack          system_settings:read
//   POST /api/admin/telemetry/stack/deploy   system_settings:write  (202, idempotent)
//
// WHY `system_settings:*` AND NOT `telemetry:*`: starting containers on the
// host through the stack-agent is a DEPLOYMENT action, not a telemetry policy
// edit — the same reach as the rest of the deployment-wide system settings.
// The Telemetry services section of /admin/settings/telemetry gates its
// content and its "Deploy GreptimeDB" button on these exact strings.
// =============================================================================

/**
 * Creates the `TelemetryStackController` class for one set of module options: its routes
 * guarded by the app's access decorators (`options.host.access`), the caller
 * resolved by `options.actorId`. `TelemetryModule.forRoot()` calls it.
 *
 * @param options - the resolved module options.
 * @returns the controller class.
 *
 * @stability experimental
 */
export function createTelemetryStackController(options: ResolvedTelemetryModuleOptions): Type<unknown> {
  const access = options.host.access;
  const ActorId = options.actorIdParam;

  @ApiTags('Telemetry')
  @Controller('admin/telemetry/stack')
  class TelemetryStackController {
    constructor(@Inject(TelemetryStackService) private readonly stack: TelemetryStackService) {}

    @Get()
    @(access.requirePermissions([TELEMETRY_HOST_PERMISSIONS.SYSTEM_SETTINGS_READ]))
    @ApiOperation({
      summary: 'Get the telemetry services status (Admin only)',
      description:
        'The state of each telemetry container (GreptimeDB, the OTel collector) as reported by the ' +
        'deployment\'s stack agent, and the most recent `telemetry.stack.deploy` job.\n\n' +
        '**Always 200.** `agent` is `available` (the agent answered), `unavailable` (configured ' +
        'but unreachable within five seconds, or an unexpected answer), `unauthorized` (it refused ' +
        'the API\'s token) or `not_configured` (this deployment has no stack agent). `agentError` ' +
        'says why the agent is `unavailable` or `unauthorized` (never the token), else null. `services` is ' +
        'empty unless `agent` is `available`. `deploy` is null when no deploy was ever requested; ' +
        '`deploy.output` is the tail (at most 4 KB) of what the agent printed.',
    })
    @ApiResponse({ status: 200, description: 'The telemetry services status', type: TelemetryStackStatusDto })
    async getStatus() {
      return this.stack.getStatus();
    }

    @Post('deploy')
    @(access.requirePermissions([TELEMETRY_HOST_PERMISSIONS.SYSTEM_SETTINGS_WRITE]))
    @HttpCode(HttpStatus.ACCEPTED)
    @ApiOperation({
      summary: 'Deploy the telemetry services (Admin only)',
      description:
        'Queues a `telemetry.stack.deploy` job, which asks the stack agent to start GreptimeDB and ' +
        'the OTel collector (pulling their images if needed — up to ten minutes), and returns at ' +
        'once with **202**. Poll `GET /api/admin/telemetry/stack` for `deploy.status`.\n\n' +
        '**Idempotent:** while a deploy is pending or running, the call returns that job\'s id ' +
        'instead of queueing another. **409** with `details.reason` `STACK_AGENT_NOT_CONFIGURED` ' +
        'when this deployment has no stack agent.',
    })
    @ApiResponse({ status: 202, description: 'The deploy job (new, or the one already in flight)', type: TelemetryStackDeployStartedDto })
    @ApiResponse({ status: 409, description: '`STACK_AGENT_NOT_CONFIGURED`', type: ErrorDto })
    async deploy(@ActorId() userId: string) {
      return this.stack.deploy(userId);
    }
  }

  return TelemetryStackController;
}
