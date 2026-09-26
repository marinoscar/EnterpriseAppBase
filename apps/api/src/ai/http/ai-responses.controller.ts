import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/constants/roles.constants';
import { ApiDataResponse } from '../../common/decorators/api-data-response.decorator';
import { ErrorDto } from '../../common/dto/error.dto';
import { AiEnabledGuard } from '../config/ai-enabled.guard';
import type { AiResponse } from '../core/types/responses.types';
import { AiService } from '../runtime/ai.service';
import { toAiRequest } from './ai-http-request';
import { AiResponseRequestDto } from './dto/ai-response-request.dto';
import { AiResponseDto } from './dto/ai-response.dto';

// =============================================================================
// AiResponsesController (issue #433, epic #419) — the consumer HTTP API
// =============================================================================
//
// HTTP access to the runtime facade for the web Playground and the CLI
// (`appctl api post /ai/responses …`):
//
//   POST /api/ai/responses              ai:use   one response
//
// `AiEnabledGuard` on the CLASS: while `ai.enabled` is false every route
// answers `403` with `details.reason: 'AI_DISABLED'` before anything else is
// read. Every other gate (provider enabled, model enabled, capability, key,
// reachability) runs inside `AiService`, the same pipeline an in-process
// caller gets — this controller adds none of its own and skips none.
//
// Every route acts on `@CurrentUser('id')`: there is no parameter that names
// a user, so a request can only ever spend the caller's own key.
//
// ⚠ NO KEY EGRESS. The facade resolves the key per call and hands it to the
// adapter; no value returned here, and no SSE frame, has a field for one.
// =============================================================================

@ApiTags('AI')
@Controller('ai')
@UseGuards(AiEnabledGuard)
export class AiResponsesController {
  constructor(private readonly ai: AiService) {}

  @Post('responses')
  @Auth({ permissions: [PERMISSIONS.AI_USE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Generate an AI response',
    description:
      'One model response, generated with **your** key for the provider (or the ' +
      'organisation key, when the deployment allows fallback and you have none).\n\n' +
      '`model` and `provider` are optional: with both omitted your `ai.defaultModel` user ' +
      'setting is used. `structuredOutput.jsonSchema` is a JSON Schema document; when given, ' +
      'the response carries `parsed`, already validated against it (output that does not ' +
      'match is `502` with `details.reason: "AI_STRUCTURED_OUTPUT_INVALID"`). Function tools ' +
      'are **not** accepted over HTTP. `maxOutputTokens` is clamped to the deployment cap and ' +
      'the model\'s own limit. The request body is limited to 1 MB.\n\n' +
      'Refusals carry the AI error code in `details.reason`: `AI_DISABLED`, ' +
      '`AI_PROVIDER_DISABLED`, `AI_MODEL_NOT_ENABLED`, `AI_KEY_REQUIRED`, ' +
      '`AI_MODEL_NOT_REACHABLE` (403); `AI_CAPABILITY_UNSUPPORTED`, `AI_INVALID_REQUEST`, ' +
      '`AI_KEY_INVALID` (400); `AI_RATE_LIMITED` (429, with `details.retryAfterMs` when the ' +
      'provider named one); `AI_CONTENT_FILTERED` (422); `AI_PROVIDER_UNAVAILABLE` (503).',
  })
  @ApiDataResponse(AiResponseDto, { description: 'The completed response' })
  @ApiResponse({
    status: 400,
    description: 'Validation error, `AI_INVALID_REQUEST`, `AI_CAPABILITY_UNSUPPORTED`, `AI_KEY_INVALID`',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 403,
    description:
      '`AI_DISABLED`, `AI_PROVIDER_DISABLED`, `AI_MODEL_NOT_ENABLED`, `AI_KEY_REQUIRED`, ' +
      '`AI_MODEL_NOT_REACHABLE`, or missing `ai:use`',
    type: ErrorDto,
  })
  @ApiResponse({ status: 422, description: '`AI_CONTENT_FILTERED`', type: ErrorDto })
  @ApiResponse({ status: 429, description: '`AI_RATE_LIMITED`', type: ErrorDto })
  @ApiResponse({ status: 502, description: '`AI_STRUCTURED_OUTPUT_INVALID`', type: ErrorDto })
  @ApiResponse({ status: 503, description: '`AI_PROVIDER_UNAVAILABLE`', type: ErrorDto })
  async respond(@Body() dto: AiResponseRequestDto, @CurrentUser('id') userId: string): Promise<AiResponse> {
    return this.ai.forUser(userId).respond(toAiRequest(dto));
  }
}
