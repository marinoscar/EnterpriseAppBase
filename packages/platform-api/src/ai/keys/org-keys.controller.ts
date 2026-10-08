import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Put } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { ApiDataResponse, ErrorDto } from '../../core/index';
import { Auth, CurrentOrg, CurrentUser } from '../../identity/index';
import { PERMISSIONS } from '../ai.constants';
import { OrgAiKeyViewDto, SetOrgAiKeyDto } from './dto/org-ai-key.dto';
import { AiOrgKeyService } from './org-key.service';

// =============================================================================
// /api/admin/ai/org-keys — an organization's own AI provider keys (issue #739)
// =============================================================================
//
// ORG SCOPE: `org_ai_config:read` / `org_ai_config:write`, held through the
// caller's membership role in their ACTIVE organization (`org_admin` by
// default). The organization is always the principal's, never request input.
//
// DELIBERATELY NOT behind `AiEnabledGuard` (CLAUDE.md AI rule 4): like every
// `/api/admin/ai/*` route, an administrator can always reach it.
//
// WRITE-ONLY: a key is verified with the provider, stored through the
// credentials slice's `OrgCredentialsService`, and never returned: the
// responses are masked views (`configured`, `hint`, `verifiedAt`).
// =============================================================================

const PROVIDER_PARAM = {
  name: 'provider',
  description: 'Provider id, e.g. `openai`.',
  example: 'openai',
} as const;

/**
 * Exported for the reference app's wiring and tests (route discovery, contract
 * and egress suites); not part of the slice's documented surface.
 *
 * @internal
 */
@ApiTags('AI Administration')
@Controller('admin/ai/org-keys')
export class AiOrgKeysController {
  constructor(private readonly orgKeys: AiOrgKeyService) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.ORG_AI_CONFIG_READ] })
  @ApiOperation({
    summary: "List your organization's AI provider keys",
    description:
      'One entry per registered provider: whether your organization stored a key, its last ' +
      'characters (`hint`) and when it was verified and stored (`verifiedAt`). **Never the key.** ' +
      'Reachable while AI is disabled.',
  })
  @ApiDataResponse(OrgAiKeyViewDto, { isArray: true, description: "The organization's keys, masked" })
  @ApiResponse({ status: 403, description: 'Missing `org_ai_config:read` in the active organization', type: ErrorDto })
  async list(@CurrentOrg() orgId: string) {
    return this.orgKeys.list(orgId);
  }

  @Put(':provider')
  @Auth({ permissions: [PERMISSIONS.ORG_AI_CONFIG_WRITE] })
  @ApiOperation({
    summary: "Set or replace your organization's key for a provider",
    description:
      'The key is **verified against the provider first** (the adapter’s own test call) and ' +
      'stored, encrypted, only when it passes. A rejected key answers **400** with ' +
      '`details.reason: "AI_KEY_INVALID"` and nothing is stored. Audited with the ' +
      "organization's id. **Write-only**: the response is the masked entry.",
  })
  @ApiParam(PROVIDER_PARAM)
  @ApiDataResponse(OrgAiKeyViewDto, { description: 'The stored key, masked' })
  @ApiResponse({ status: 400, description: 'Validation error, or `AI_KEY_INVALID`', type: ErrorDto })
  @ApiResponse({ status: 403, description: 'Missing `org_ai_config:write` in the active organization', type: ErrorDto })
  @ApiResponse({ status: 404, description: 'Unknown provider', type: ErrorDto })
  @ApiResponse({ status: 503, description: 'The provider could not be reached to verify the key', type: ErrorDto })
  async set(
    @Param('provider') provider: string,
    @Body() dto: SetOrgAiKeyDto,
    @CurrentOrg() orgId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.orgKeys.set(orgId, provider, dto.apiKey, userId);
  }

  @Delete(':provider')
  @Auth({ permissions: [PERMISSIONS.ORG_AI_CONFIG_WRITE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary: "Remove your organization's key for a provider",
    description: 'Idempotent: removing a key that is not there is a 204. Audited.',
  })
  @ApiParam(PROVIDER_PARAM)
  @ApiResponse({ status: 204, description: 'Removed (or there was nothing to remove)' })
  @ApiResponse({ status: 403, description: 'Missing `org_ai_config:write` in the active organization', type: ErrorDto })
  @ApiResponse({ status: 404, description: 'Unknown provider', type: ErrorDto })
  async remove(@Param('provider') provider: string, @CurrentOrg() orgId: string, @CurrentUser('id') userId: string) {
    await this.orgKeys.remove(orgId, provider, userId);
  }
}
