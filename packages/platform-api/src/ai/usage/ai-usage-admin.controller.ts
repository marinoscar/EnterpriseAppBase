import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth, CurrentOrg } from '../../identity/index';
import { PERMISSIONS } from '../ai.constants';
import { ApiDataResponse } from '../../core/index';
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

@ApiTags('AI Administration')
@Controller('admin/ai')
export class AiUsageAdminController {
  constructor(private readonly usage: AiUsageService) {}

  @Get('usage')
  @Auth({ permissions: [PERMISSIONS.AI_CONFIG_READ] })
  @ApiOperation({
    summary: 'AI usage aggregates across all users (Admin only)',
    description:
      'Sums the recorded provider round trips (`ai_usage_events`) over a window of UTC days, ' +
      `both inclusive — default the last ${DEFAULT_AI_USAGE_RANGE_DAYS} days, at most ` +
      `${MAX_AI_USAGE_RANGE_DAYS} — as \`totals\` plus one \`series\` entry per group.\n\n` +
      '`groupBy`: `day` (chronological, zero-filled), `user` (label is the email; events ' +
      'with no user are keyed `system`), `model` (key `<provider>:<modelId>`), `provider`, or ' +
      '`keySource` (`user` / `org` / `none` / `admin_discovery`), or `org` (one entry per ' +
      'organization, labelled with its name; events with none are keyed `none`). The `orgKey*` ' +
      'fields of every bucket are the part paid for by an administrator-managed key (the ' +
      "organization's own or the deployment's). `orgId` narrows the report to one " +
      "organization's events.\n\n" +
      'Reachable while AI is disabled. Refused with **400** (`details.reason: ' +
      '"AI_USAGE_RANGE_INVALID"`) for a reversed or over-long range.',
  })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'First UTC day included, `YYYY-MM-DD`.' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'Last UTC day included, `YYYY-MM-DD`. Default today.' })
  @ApiQuery({ name: 'groupBy', required: false, enum: AI_USAGE_ADMIN_GROUP_BY, description: 'Default `day`.' })
  @ApiQuery({ name: 'userId', required: false, type: String, format: 'uuid', description: "Only this user's events." })
  @ApiQuery({ name: 'provider', required: false, type: String, description: "Only this provider's events." })
  @ApiQuery({ name: 'model', required: false, type: String, description: "Only this provider model id's events." })
  @ApiQuery({ name: 'orgId', required: false, type: String, format: 'uuid', description: "Only this organization's events." })
  @ApiDataResponse(AiUsageReportDto, { description: 'The usage report' })
  @ApiResponse({ status: 400, description: 'Invalid query, or `AI_USAGE_RANGE_INVALID`', type: ErrorDto })
  async report(@Query() query: AiUsageAdminQueryDto): Promise<AiUsageReport> {
    return this.usage.report(query);
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
  @ApiQuery({ name: 'from', required: false, type: String, description: 'First UTC day included, `YYYY-MM-DD`.' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'Last UTC day included, `YYYY-MM-DD`. Default today.' })
  @ApiQuery({ name: 'groupBy', required: false, enum: AI_USAGE_ORG_GROUP_BY, description: 'Default `day`.' })
  @ApiQuery({ name: 'userId', required: false, type: String, format: 'uuid', description: "Only this member's events." })
  @ApiQuery({ name: 'provider', required: false, type: String, description: "Only this provider's events." })
  @ApiQuery({ name: 'model', required: false, type: String, description: "Only this provider model id's events." })
  @ApiDataResponse(AiUsageReportDto, { description: "The organization's usage report" })
  @ApiResponse({ status: 400, description: 'Invalid query, or `AI_USAGE_RANGE_INVALID`', type: ErrorDto })
  @ApiResponse({ status: 403, description: 'Missing `org_ai_config:read` in the active organization', type: ErrorDto })
  async orgReport(@Query() query: AiUsageOrgQueryDto, @CurrentOrg() orgId: string): Promise<AiUsageReport> {
    return this.usage.report({ ...query, orgId }, new Date(), orgId);
  }
}
