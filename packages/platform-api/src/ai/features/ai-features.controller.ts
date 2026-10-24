import { Controller, Get, UseGuards, UseInterceptors } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ApiDataResponse, ErrorDto } from '../../core/index';
import { Auth, CurrentOrg, CurrentUser } from '../../identity/index';
import { PERMISSIONS } from '../ai.constants';
import { AiEnabledGuard } from '../config/ai-enabled.guard';
import { AiOrgEnabledInterceptor } from '../config/ai-org-enabled.interceptor';
import { AiFeaturesService } from './ai-features.service';
import { AiFeatureViewDto } from './dto/ai-feature.dto';

// =============================================================================
// GET /api/ai/features (issue #739)
// =============================================================================
//
// The registry of app AI features (`registerAiFeature`) as the caller sees it.
// A consumer route: behind `AiEnabledGuard` plus `ai:use`, like every
// `/api/ai/*` route but `GET /api/ai/config` (CLAUDE.md AI rule 4).
// =============================================================================

/**
 * Exported for the reference app's wiring and tests (route discovery, contract
 * and egress suites); not part of the slice's documented surface.
 *
 * @internal
 */
@ApiTags('AI')
@Controller('ai')
@UseGuards(AiEnabledGuard)
@UseInterceptors(AiOrgEnabledInterceptor)
export class AiFeaturesController {
  constructor(private readonly features: AiFeaturesService) {}

  @Get('features')
  @Auth({ permissions: [PERMISSIONS.AI_USE] })
  @ApiOperation({
    summary: 'List the registered AI features',
    description:
      'Every AI feature this application registered, in registration order, with what it needs ' +
      'from a model and `usable`: whether you have a usable model for it right now (an enabled ' +
      'model your key, your organization’s or the deployment’s reaches, with every capability and ' +
      'input modality the feature needs). `403` with `details.reason: "AI_DISABLED"` while AI is disabled.',
  })
  @ApiDataResponse(AiFeatureViewDto, { isArray: true, description: 'The registered features' })
  @ApiResponse({ status: 403, description: '`AI_DISABLED`, or missing `ai:use`', type: ErrorDto })
  async list(@CurrentUser('id') userId: string, @CurrentOrg() orgId: string) {
    return this.features.listForUser(userId, orgId);
  }
}
