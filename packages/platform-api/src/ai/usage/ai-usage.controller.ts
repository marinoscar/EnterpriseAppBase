import { Controller, Get, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth, CurrentOrg, CurrentUser } from '../../identity/index';
import { PERMISSIONS } from '../ai.constants';
import { ApiDataResponse } from '../../core/index';
import { ErrorDto } from '../../core/index';
import { AiEnabledGuard } from '../config/ai-enabled.guard';
import { AiOrgEnabledInterceptor } from '../config/ai-org-enabled.interceptor';
import { AiUsageService } from './ai-usage.service';
import {
  AI_USAGE_ME_GROUP_BY,
  AiUsageMeQueryDto,
  AiUsageReportDto,
  DEFAULT_AI_USAGE_RANGE_DAYS,
  MAX_AI_USAGE_RANGE_DAYS,
  type AiUsageReport,
} from './dto/ai-usage.dto';

// =============================================================================
// AiUsageController (issue #443, epic #420)
// =============================================================================
//
//   GET /api/ai/usage/me     ai:use (+ AiEnabledGuard)     the caller's own usage
//
// OWNER-SCOPED BY CONSTRUCTION: the query DTO has no `userId` (an extra query
// parameter is stripped by the Zod pipe), and the service is always handed the
// authenticated caller's id. There is no way to ask this route about anyone
// else.
// =============================================================================

/**
 * Exported for the reference app's wiring and tests (route discovery, contract
 * and egress suites); not part of the slice's documented surface.
 *
 * @internal
 */
@ApiTags('AI')
@Controller('ai/usage')
@UseGuards(AiEnabledGuard)
@UseInterceptors(AiOrgEnabledInterceptor)
export class AiUsageController {
  constructor(private readonly usage: AiUsageService) {}

  @Get('me')
  @Auth({ permissions: [PERMISSIONS.AI_USE] })
  @ApiOperation({
    summary: 'My AI usage',
    description:
      'Your own recorded provider round trips, summed over a window of UTC days, both ' +
      `inclusive — default the last ${DEFAULT_AI_USAGE_RANGE_DAYS} days, at most ` +
      `${MAX_AI_USAGE_RANGE_DAYS}. Same shape as the admin report; \`groupBy\` is \`day\` ` +
      '(chronological, zero-filled) or `model` (key `<provider>:<modelId>`). The `orgKey*` ' +
      'fields are the part the organization key paid for rather than your own key.\n\n' +
      'Refused with **400** (`details.reason: "AI_USAGE_RANGE_INVALID"`) for a reversed or ' +
      'over-long range.',
  })
  @ApiQuery({ name: 'from', required: false, type: String, description: 'First UTC day included, `YYYY-MM-DD`.' })
  @ApiQuery({ name: 'to', required: false, type: String, description: 'Last UTC day included, `YYYY-MM-DD`. Default today.' })
  @ApiQuery({ name: 'groupBy', required: false, enum: AI_USAGE_ME_GROUP_BY, description: 'Default `day`.' })
  @ApiDataResponse(AiUsageReportDto, { description: 'Your usage report' })
  @ApiResponse({ status: 400, description: 'Invalid query, or `AI_USAGE_RANGE_INVALID`', type: ErrorDto })
  @ApiResponse({ status: 403, description: '`AI_DISABLED`, or missing `ai:use`', type: ErrorDto })
  async mine(
    @Query() query: AiUsageMeQueryDto,
    @CurrentUser('id') userId: string,
    @CurrentOrg() orgId: string,
  ): Promise<AiUsageReport> {
    return this.usage.report({ from: query.from, to: query.to, groupBy: query.groupBy, userId }, undefined, orgId);
  }
}
