import { Body, Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/constants/roles.constants';
import { ApiDataResponse } from '../../common/decorators/api-data-response.decorator';
import { ErrorDto } from '../../common/dto/error.dto';
import { AiEnabledGuard } from '../config/ai-enabled.guard';
import { AiService } from '../runtime/ai.service';
import type { AiRunHandle, AiTranscribeRequest } from '../runtime/ai-runtime.types';
import { AiTranscriptionRequestDto, type AiTranscriptionRequestInput } from './dto/ai-audio.dto';
import { AiRunStartedDto } from './dto/ai-response.dto';

// =============================================================================
// AiAudioController (issue #438, epic #420)
// =============================================================================
//
//   POST /api/ai/audio/transcriptions   ai:use   transcribe my recording   -> 202 { runId, jobId }
//
// ALWAYS ASYNCHRONOUS. Each request becomes an `ai_runs` row executed by one
// `ai.audio.transcribe` job (CLAUDE.md: every long-running activity is a
// queue job); the transcript is read from the existing
// `GET /api/ai/runs/{runId}` (`output.text`). The recording is the caller's
// own storage object, streamed to the provider by the job — its bytes never
// travel in this request.
//
// The gates run now — an unusable request (AI off, no key, a model without
// the capability, a recording that is not the caller's, not audio or too
// large) is refused here with the ordinary JSON error — and again when the
// job executes. An unknown id is 404 and somebody else's is 403, the answers
// `/api/storage/objects/{id}` gives.
//
// `AiEnabledGuard` on the CLASS (the kill switch answers before auth).
// =============================================================================

const REFUSALS =
  'Refusals carry the AI error code in `details.reason`: `AI_DISABLED`, `AI_PROVIDER_DISABLED`, ' +
  '`AI_MODEL_NOT_ENABLED`, `AI_KEY_REQUIRED`, `AI_MODEL_NOT_REACHABLE` (403); ' +
  '`AI_CAPABILITY_UNSUPPORTED`, `AI_INVALID_REQUEST` (400). A run that later cannot proceed ends ' +
  '`failed` with the code in `errorCode`.';

@ApiTags('AI')
@Controller('ai/audio')
@UseGuards(AiEnabledGuard)
export class AiAudioController {
  constructor(private readonly ai: AiService) {}

  @Post('transcriptions')
  @Auth({ permissions: [PERMISSIONS.AI_USE] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({
    summary: 'Transcribe a recording',
    description:
      'Queues a transcription (speech-to-text) of a recording you uploaded through ' +
      '`/api/storage/objects`, with **your** key for the provider (or the organisation key, when ' +
      'the deployment allows fallback and you have none), and returns at once with **202**. Poll ' +
      '`GET /api/ai/runs/{runId}`: once `succeeded`, `output` is ' +
      '`{ type: "transcription", text, language?, durationSeconds?, segments?, words? }`.\n\n' +
      '`storageObjectId` must be `ready`, an audio type (`audio/*`) or `video/mp4`/`video/webm`, ' +
      'and within the provider\'s limit (25 MiB for OpenAI). An unknown id is **404** and another ' +
      'user\'s is **403**, as the storage API itself answers. `model` must be an enabled model ' +
      'with the `audio_transcription` capability; omit it to use the first one available to you. ' +
      'Always asynchronous, whatever `allowBackgroundRuns` says.\n\n' +
      REFUSALS,
  })
  @ApiDataResponse(AiRunStartedDto, { status: 202, description: 'The transcription run was queued' })
  @ApiResponse({
    status: 400,
    description:
      'Validation error, `AI_INVALID_REQUEST` (including a recording that is not ready, not audio, ' +
      'or too large, and no transcription model available), `AI_CAPABILITY_UNSUPPORTED`',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 403,
    description:
      'A recording that is not yours; `AI_DISABLED`, `AI_PROVIDER_DISABLED`, `AI_MODEL_NOT_ENABLED`, ' +
      '`AI_KEY_REQUIRED`, `AI_MODEL_NOT_REACHABLE`; or missing `ai:use`',
    type: ErrorDto,
  })
  @ApiResponse({ status: 404, description: 'The recording\'s storage object does not exist', type: ErrorDto })
  async transcribe(
    @Body() dto: AiTranscriptionRequestDto,
    @CurrentUser('id') userId: string,
  ): Promise<AiRunHandle> {
    return this.ai.forUser(userId).transcribe(toTranscribeRequest(dto));
  }
}

/** Named fields only — a key added to the DTO later does not reach a provider unexamined. */
function toTranscribeRequest(body: AiTranscriptionRequestInput): AiTranscribeRequest {
  const request: AiTranscribeRequest = { storageObjectId: body.storageObjectId };

  if (body.provider !== undefined) request.provider = body.provider;
  if (body.model !== undefined) request.model = body.model;
  if (body.language !== undefined) request.language = body.language;
  if (body.prompt !== undefined) request.prompt = body.prompt;
  if (body.timestampGranularities !== undefined) request.timestampGranularities = body.timestampGranularities;
  if (body.providerOptions !== undefined) request.providerOptions = body.providerOptions;

  return request;
}
