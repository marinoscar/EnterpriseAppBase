import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Put,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/constants/roles.constants';
import { ErrorDto } from '../../common/dto/error.dto';
import { AiConfigAdminService } from './ai-config-admin.service';
import { AiConfigResponseDto, AiKeyRemovalResponseDto } from './dto/ai-config-response.dto';
import { RemoveAiProviderKeyDto, SetAiProviderKeyDto } from './dto/ai-provider-key.dto';
import { UpdateAiConfigDto } from './dto/update-ai-config.dto';

// =============================================================================
// AiAdminController (issue #428, epic #419)
// =============================================================================
//
// The HTTP surface behind the admin AI settings page (#429). Every route is
// gated on `ai_config:read` / `ai_config:write` — a permission pair of its own,
// for the blast-radius reason docs/specs/ai-platform.md §11 gives — and NONE is
// behind `AiEnabledGuard`: an administrator must always be able to turn the
// platform back on (§8).
//
//   GET    /api/admin/ai/config                      ai_config:read
//   PUT    /api/admin/ai/config                      ai_config:write
//   PUT    /api/admin/ai/providers/:provider/key     ai_config:write
//   DELETE /api/admin/ai/providers/:provider/key     ai_config:write
//
// ⚠ THE ADMIN KEY IS WRITE-ONLY. No route here, or anywhere, returns it; the
// responses carry `keyStatus` — a masked hint built without decrypting.
// =============================================================================

const PROVIDER_PARAM = {
  name: 'provider',
  description: 'Provider id, e.g. `openai`.',
  example: 'openai',
} as const;

@ApiTags('AI Administration')
@Controller('admin/ai')
export class AiAdminController {
  constructor(private readonly admin: AiConfigAdminService) {}

  @Get('config')
  @Auth({ permissions: [PERMISSIONS.AI_CONFIG_READ] })
  @ApiOperation({
    summary: 'Get the AI platform configuration (Admin only)',
    description:
      'The `ai` settings namespace — the kill switch, the key policy, prompt logging, ' +
      'defaults — plus one entry per provider (every registered adapter and every provider ' +
      'with a settings slot) carrying its `enabled` switch, `baseUrl` override, the ' +
      'capabilities its adapter supports, and `keyStatus`: a masked description of the ' +
      'stored admin key. **The admin key itself is never returned by this or any other ' +
      'endpoint.**\n\n' +
      'Reachable while AI is disabled — this is how an administrator turns it back on.',
  })
  @ApiResponse({ status: 200, description: 'The AI configuration', type: AiConfigResponseDto })
  async getConfig() {
    return this.admin.describeForAdmin();
  }

  @Put('config')
  @Auth({ permissions: [PERMISSIONS.AI_CONFIG_WRITE] })
  @ApiOperation({
    summary: 'Replace the AI platform configuration (Admin only)',
    description:
      'Full replace of the `ai` namespace. `providers` is keyed by provider id; a provider ' +
      'left out keeps its stored settings. Takes effect immediately on this instance and ' +
      'within five seconds on every other one — no restart.\n\n' +
      'Refused with **400** (reason in `details.reason`) when it enables a provider with no ' +
      'registered adapter (`AI_PROVIDER_NOT_REGISTERED`), names a provider this deployment ' +
      'has no settings slot for (`AI_UNKNOWN_PROVIDER`), selects `byok_with_org_fallback` ' +
      'while AI is on and an enabled provider has no admin key (`AI_KEY_REQUIRED`), or tries ' +
      'to clear a stored `baseUrl` / `maxOutputTokensCap` (`AI_SETTING_CLEAR_UNSUPPORTED` — ' +
      'not supported yet). Nothing is written when any of these apply.\n\n' +
      'There is no key field: the admin key has its own routes, so it is verified before it ' +
      'is stored and never travels with a settings save.',
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
  @ApiResponse({ status: 200, description: 'The updated AI configuration', type: AiConfigResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error, or a rejected combination (see above)', type: ErrorDto })
  @ApiResponse({ status: 409, description: 'Version conflict', type: ErrorDto })
  async replaceConfig(
    @Body() dto: UpdateAiConfigDto,
    @CurrentUser('id') userId: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    // An unparseable `If-Match` is treated as absent, exactly as
    // `StorageConfigController` does — `NaN !== version` would otherwise turn
    // every save into a 409 no reload can fix.
    const parsed = ifMatch !== undefined ? Number.parseInt(ifMatch, 10) : NaN;
    const expectedVersion = Number.isInteger(parsed) ? parsed : undefined;

    return this.admin.replace(dto, userId, expectedVersion);
  }

  @Put('providers/:provider/key')
  @Auth({ permissions: [PERMISSIONS.AI_CONFIG_WRITE] })
  @ApiOperation({
    summary: "Set or rotate a provider's admin key (Admin only)",
    description:
      'Stores the admin (org) key for one provider in the encrypted credential store. The ' +
      'key is **verified against the provider first**: a rejected key answers **400** with ' +
      '`details.reason: "AI_KEY_INVALID"` and **nothing is stored**, so a typo can never ' +
      'replace a working key. An unreachable provider answers with its own error (e.g. 503 ' +
      '`AI_PROVIDER_UNAVAILABLE`), also storing nothing.\n\n' +
      'The admin key drives catalog discovery and the connection test, and serves users ' +
      'only under the `byok_with_org_fallback` key policy. It is **write-only**: the response ' +
      'is the admin view, carrying a masked `keyStatus.hint`, never the key.',
  })
  @ApiParam(PROVIDER_PARAM)
  @ApiResponse({ status: 200, description: 'The updated AI configuration', type: AiConfigResponseDto })
  @ApiResponse({ status: 400, description: 'Validation error, or `AI_KEY_INVALID`', type: ErrorDto })
  @ApiResponse({ status: 404, description: 'No adapter is registered for this provider', type: ErrorDto })
  @ApiResponse({ status: 503, description: 'The provider could not be reached to verify the key', type: ErrorDto })
  async setKey(
    @Param('provider') provider: string,
    @Body() dto: SetAiProviderKeyDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.admin.setKey(provider, dto.apiKey, userId);
  }

  @Delete('providers/:provider/key')
  @Auth({ permissions: [PERMISSIONS.AI_CONFIG_WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: "Remove a provider's admin key (Admin only)",
    description:
      'Deletes the stored admin key. Requires the typed confirmation ' +
      '`{ "confirmation": "REMOVE" }`. Idempotent. Catalog refresh and the connection test ' +
      'stop working for this provider until a new key is saved.\n\n' +
      'When the key policy is `byok_with_org_fallback`, the response carries ' +
      '`warnings: ["ORG_FALLBACK_WITHOUT_KEY"]` — users without their own key now have no ' +
      'key for this provider.',
  })
  @ApiParam(PROVIDER_PARAM)
  @ApiResponse({
    status: 200,
    description: 'The resulting configuration, plus `warnings`',
    type: AiKeyRemovalResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Missing or incorrect confirmation', type: ErrorDto })
  @ApiResponse({ status: 404, description: 'Unknown provider', type: ErrorDto })
  async deleteKey(
    @Param('provider') provider: string,
    @Body() _dto: RemoveAiProviderKeyDto,
    @CurrentUser('id') userId: string,
  ) {
    return this.admin.deleteKey(provider, userId);
  }
}
