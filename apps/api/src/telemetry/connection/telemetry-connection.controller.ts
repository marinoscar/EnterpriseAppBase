import { Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/constants/roles.constants';
import { ErrorDto } from '../../common/dto/error.dto';
import {
  TelemetryConnectionResponseDto,
  TelemetryConnectionTestResultDto,
  TestTelemetryConnectionDto,
  UpdateTelemetryConnectionDto,
} from './dto/telemetry-connection.dto';
import { TelemetryConnectionAdminService } from './telemetry-connection-admin.service';
import { TelemetryConnectionTestService } from './telemetry-connection-test.service';

// =============================================================================
// TelemetryConnectionController (issue #558, epic #528)
// =============================================================================
//
//   GET    /api/admin/telemetry/connection        telemetry:read
//   PUT    /api/admin/telemetry/connection        telemetry:write  (If-Match optional → 409)
//   DELETE /api/admin/telemetry/connection        telemetry:write  (If-Match optional → 409)
//   POST   /api/admin/telemetry/connection/test   telemetry:write  (always 200)
//
// The same permission strings as the rest of the telemetry admin surface, so
// the one `telemetry` settings card covers it (CLAUDE.md, Settings UI Pattern
// rule 3).
// =============================================================================

const IF_MATCH_DESCRIPTION =
  'Expected `version` of the stored connection, for optimistic concurrency (`0` asserts ' +
  'nothing is stored). Omit to write unconditionally. The connection has its own version ' +
  'counter, so a concurrent save of an unrelated setting cannot conflict with it.';

@ApiTags('Telemetry')
@Controller('admin/telemetry/connection')
export class TelemetryConnectionController {
  constructor(
    private readonly admin: TelemetryConnectionAdminService,
    private readonly tester: TelemetryConnectionTestService,
  ) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.TELEMETRY_READ] })
  @ApiOperation({
    summary: 'Get the telemetry store connection (Admin only)',
    description:
      'The GreptimeDB connection in force and where it comes from: `source` is `stored` ' +
      '(saved on this page — used wholly, with no field taken from the environment), ' +
      '`environment` (the `GREPTIME_*` deployment default) or `none`.\n\n' +
      '**Passwords are never returned.** `credentials.reader` / `credentials.admin` say ' +
      'whether each password is present, with a masked `hint` for a stored one (always null ' +
      'for the deployment default).',
  })
  @ApiResponse({ status: 200, description: 'The telemetry store connection', type: TelemetryConnectionResponseDto })
  async getConnection() {
    return this.admin.describeForAdmin();
  }

  @Put()
  @Auth({ permissions: [PERMISSIONS.TELEMETRY_WRITE] })
  @ApiOperation({
    summary: 'Save the telemetry store connection (Admin only)',
    description:
      'Stores a GreptimeDB connection, which from then on is used INSTEAD OF the `GREPTIME_*` ' +
      'deployment default, wholly. It takes effect on this instance immediately and on every ' +
      'other one within five seconds — no restart.\n\n' +
      '`readerPassword` / `adminPassword` are **write-only**: omit them or send them empty to ' +
      'keep the stored ones. A save with no stored password to keep is a 400 — the deployment ' +
      'default\'s password is never copied into the store. `adminUser: null` removes the admin ' +
      'login and its stored password (retention is then not applied).\n\n' +
      'Every save re-applies the export gate and queues a `telemetry.retention.apply` job.',
  })
  @ApiHeader({ name: 'If-Match', description: IF_MATCH_DESCRIPTION, required: false })
  @ApiResponse({ status: 200, description: 'The saved connection', type: TelemetryConnectionResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error, or a required password is missing', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'Version conflict', type: ErrorDto })
  async replaceConnection(
    @Body() dto: UpdateTelemetryConnectionDto,
    @CurrentUser('id') userId: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.admin.replace(dto, userId, parseIfMatch(ifMatch));
  }

  @Delete()
  @Auth({ permissions: [PERMISSIONS.TELEMETRY_WRITE] })
  @ApiOperation({
    summary: 'Reset the telemetry store connection (Admin only)',
    description:
      'Deletes the stored connection and both stored passwords, so the `GREPTIME_*` deployment ' +
      'default applies again (or no connection, when the deployment has none). Takes effect ' +
      'like a save: immediately here, within five seconds everywhere else.',
  })
  @ApiHeader({ name: 'If-Match', description: IF_MATCH_DESCRIPTION, required: false })
  @ApiResponse({ status: 200, description: 'The connection now in force', type: TelemetryConnectionResponseDto })
  @ApiResponse({ status: 409, description: 'Version conflict', type: ErrorDto })
  async resetConnection(@CurrentUser('id') userId: string, @Headers('if-match') ifMatch?: string) {
    return this.admin.reset(userId, parseIfMatch(ifMatch));
  }

  @Post('test')
  @Auth({ permissions: [PERMISSIONS.TELEMETRY_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Test a telemetry store connection (Admin only)',
    description:
      'Checks the connection **in the request body**, which does not have to have been saved: ' +
      'the reader runs `SELECT version()`, the admin (when `adminUser` is set) runs ' +
      '`SHOW CREATE DATABASE <database>`. A blank password means the one the connection in ' +
      'force uses for that login.\n\n' +
      '**Always 200** — read `reader.success` and `admin.success` (or `admin.skipped`). Each ' +
      'check is bounded to five seconds to connect and five to answer.',
  })
  @ApiResponse({ status: 200, description: 'The outcome of each check', type: TelemetryConnectionTestResultDto })
  @ApiResponse({ status: 400, description: 'Validation error', type: ErrorDto })
  async testConnection(@Body() dto: TestTelemetryConnectionDto, @CurrentUser('id') userId: string) {
    return this.tester.test(dto, userId);
  }
}

/** An unparseable `If-Match` is treated as absent, exactly as the other admin controllers do. */
function parseIfMatch(ifMatch: string | undefined): number | undefined {
  const parsed = ifMatch !== undefined ? Number.parseInt(ifMatch, 10) : NaN;

  return Number.isInteger(parsed) ? parsed : undefined;
}
