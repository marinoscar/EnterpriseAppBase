import { Controller, Get, Query, Req } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth, CurrentOrg, CurrentUser } from '../../identity/index';
import { PERMISSIONS } from '../ai.constants';
import { ApiDataResponse, type RequestWithHeaders } from '../../core/index';
import { SettingsResolver } from '../../settings/index';
import { ErrorDto } from '../../core/index';
import { AiUsageService } from './ai-usage.service';
import {
  AI_USAGE_ADMIN_GROUP_BY,
  AI_USAGE_ORG_GROUP_BY,
  AiUsageAdminQueryDto,
  AiUsageOrgQueryDto,
  AiUsageReportDto,
  DEFAULT_AI_USAGE_RANGE_DAYS,
  MAX_AI_USAGE_RANGE_DAYS,
  type AiUsageReport,
} from './dto/ai-usage.dto';

// =============================================================================
// AiUsageAdminController (issue #443, epic #420)
// =============================================================================
//
//   GET /api/admin/ai/usage     ai_config:read     every user's usage, filterable
//
// Same `/api/admin/ai` prefix, permission pair and posture as
// `AiAdminController`: NOT behind `AiEnabledGuard` — an administrator reading
// what the platform cost while it is switched off is exactly the case that
// must keep working (docs/specs/ai-platform.md §2.19).
// =============================================================================

/**
 * Exported for the reference app's wiring and tests (route discovery, contract
 * and egress suites); not part of the slice's documented surface.
 *
 * @internal
 */
@ApiTags('AI Administration')
@Controller('admin/ai')
export class AiUsageAdminController {
  constructor(
    private readonly usage: AiUsageService,
    private readonly settings: SettingsResolver,
  ) {}

  @Get('usage')
  @Auth({ permissions: [PERMISSIONS.AI_CONFIG_READ] })
  @ApiOperation({
    summary: 'AI usage aggregates across all users (Admin only)',
    description:
      'Sums the recorded provider round trips (`ai_usage_events`) over a window of calendar days in `timeZone` (query `tz`, default the caller\'s profile zone, then UTC), ' +
      `both inclusive — default the last ${DEFAULT_AI_USAGE_RANGE_DAYS} days, at most ` +
      `${MAX_AI_USAGE_RANGE_DAYS} — as \`totals\` plus one \`series\` entry per group.\n\n` +
      '`groupBy`: `day` (chronological, zero-filled), `user` (label is the email; events ' +
      'with no user are keyed `system`), `model` (key `<provider>:<modelId>`), `provider`, or ' +
      '`keySource` (`user` / `org` / `none` / `admin_discovery`), or `org` (one entry per ' +
      'organization, labelled with its name; events with none are keyed `none`). The `orgKey*` ' +
      'fields of every bucket are the part paid for by an administrator-managed key (the ' +
      "organization's own or the deployment's). `orgId` narrows the report to one " +
      "organization's events, and `feature` to one registered AI feature. `groupBy` also takes " +
      '`feature` (key: the feature id, `none` for events recorded without one) and `operation` ' +
      '(key: the operation id). When the deployment binds a pricing port ' +
      '(`AiModule.forRoot({ pricing })`) the report carries `priced: true` and a `cost` on every ' +
      'bucket.\n\n' +
      'Reachable while AI is disabled. Refused with **400** (`details.reason: ' +
      '"AI_USAGE_RANGE_INVALID"`) for a reversed or over-long range.',
  })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'First day included in `timeZone`, `YYYY-MM-DD`.' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'Last day included in `timeZone`, `YYYY-MM-DD`. Default today there.' })
  @ApiQuery({ name: 'tz', required: false, type: String, description: 'IANA time zone the days are cut in (`America/Costa_Rica`). Default: your profile zone, then the `X-Time-Zone` header, then `UTC`. Echoed as `timeZone`.' })
  @ApiQuery({ name: 'groupBy', required: false, enum: AI_USAGE_ADMIN_GROUP_BY, description: 'Default `day`.' })
  @ApiQuery({ name: 'userId', required: false, type: String, format: 'uuid', description: "Only this user's events." })
  @ApiQuery({ name: 'provider', required: false, type: String, description: "Only this provider's events." })
  @ApiQuery({ name: 'model', required: false, type: String, description: "Only this provider model id's events." })
  @ApiQuery({ name: 'orgId', required: false, type: String, format: 'uuid', description: "Only this organization's events." })
  @ApiQuery({ name: 'feature', required: false, type: String, description: 'Only events recorded for this registered AI feature.' })
  @ApiDataResponse(AiUsageReportDto, { description: 'The usage report' })
  @ApiResponse({ status: 400, description: 'Invalid query, or `AI_USAGE_RANGE_INVALID`', type: ErrorDto })
  async report(
    @Query() query: AiUsageAdminQueryDto,
    @CurrentUser('id') userId: string,
    @Req() request: RequestWithHeaders,
  ): Promise<AiUsageReport> {
    const { tz, ...filters } = query;
    const timeZone = tz ?? (await this.settings.resolveRequestTimeZone(request, userId));
    return this.usage.report({ ...filters, timeZone, withCost: true });
  }

  @Get('org-usage')
  @Auth({ permissions: [PERMISSIONS.ORG_AI_CONFIG_READ] })
  @ApiOperation({
    summary: "AI usage aggregates of your organization (organization administrators)",
    description:
      "The same report as `GET /api/admin/ai/usage`, always confined to the caller's ACTIVE " +
      'organization (never a request parameter): it reads through that organization\'s ' +
      'row-level-security scope, so no other organization\'s rows are visible. Gated by ' +
      '`org_ai_config:read` in that organization. Reachable while AI is disabled.',
  })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'First day included in `timeZone`, `YYYY-MM-DD`.' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'Last day included in `timeZone`, `YYYY-MM-DD`. Default today there.' })
  @ApiQuery({ name: 'tz', required: false, type: String, description: 'IANA time zone the days are cut in (`America/Costa_Rica`). Default: your profile zone, then the `X-Time-Zone` header, then `UTC`. Echoed as `timeZone`.' })
  @ApiQuery({ name: 'groupBy', required: false, enum: AI_USAGE_ORG_GROUP_BY, description: 'Default `day`.' })
  @ApiQuery({ name: 'userId', required: false, type: String, format: 'uuid', description: "Only this member's events." })
  @ApiQuery({ name: 'provider', required: false, type: String, description: "Only this provider's events." })
  @ApiQuery({ name: 'model', required: false, type: String, description: "Only this provider model id's events." })
  @ApiQuery({ name: 'feature', required: false, type: String, description: 'Only events recorded for this registered AI feature.' })
  @ApiDataResponse(AiUsageReportDto, { description: "The organization's usage report" })
  @ApiResponse({ status: 400, description: 'Invalid query, or `AI_USAGE_RANGE_INVALID`', type: ErrorDto })
  @ApiResponse({ status: 403, description: 'Missing `org_ai_config:read` in the active organization', type: ErrorDto })
  async orgReport(
    @Query() query: AiUsageOrgQueryDto,
    @CurrentOrg() orgId: string,
    @CurrentUser('id') userId: string,
    @Req() request: RequestWithHeaders,
  ): Promise<AiUsageReport> {
    const { tz, ...filters } = query;
    const timeZone = tz ?? (await this.settings.resolveRequestTimeZone(request, userId));
    return this.usage.report({ ...filters, orgId, timeZone, withCost: true }, new Date(), orgId);
  }
}
