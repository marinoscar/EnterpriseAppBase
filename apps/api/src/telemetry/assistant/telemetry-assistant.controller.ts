import { Body, Controller, HttpCode, HttpStatus, Post, Res, UseGuards } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';

import { AiEnabledGuard } from '../../ai/config/ai-enabled.guard';
import { AI_SSE_HEARTBEAT_MS, abortOnDisconnect } from '../../ai/http/ai-sse';
import { Auth } from '../../auth/decorators/auth.decorator';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { PERMISSIONS } from '../../common/constants/roles.constants';
import { ErrorDto } from '../../common/dto/error.dto';
import { TelemetryAssistantRequestDto } from '../dto/telemetry-assistant.dto';
import { TelemetryAssistantService } from './telemetry-assistant.service';
import { openTelemetrySse } from './telemetry-assistant.sse';

// =============================================================================
// TelemetryAssistantController (issue #536, epic #528)
// =============================================================================
//
//   POST /api/admin/telemetry/assistant/stream   telemetry:query AND ai:use (SSE)
//
// ACCESS. `@Auth({ permissions: [...] })` is ALL-OF (`PermissionsGuard` uses
// `every`), so the caller must hold both: `telemetry:query` because the
// assistant reads telemetry data, `ai:use` because it spends an AI key.
// `AiEnabledGuard` answers 403 `AI_DISABLED` while the platform is off. This
// route lives under `/api/admin/telemetry`, not `/api/ai`, so the AI
// kill-switch and RBAC tripwire suites (which discover `/api/ai*` and
// `/api/admin/ai*`) do not enumerate it; the guard is applied explicitly and
// pinned by this controller's spec.
//
// STREAMING. Like `POST /api/ai/responses/stream` (see `ai/http/ai-sse.ts`),
// not `@Sse()`: the service's preconditions run BEFORE anything is written,
// so "assistant disabled", "no model selected" and friends are ordinary JSON
// errors with `details.reason`. The response is committed to
// `text/event-stream` only on the first event (`openTelemetrySse` hijacks the
// reply lazily). Closing the connection aborts the provider call and the
// in-flight query.
//
// nginx: `location /api/admin/telemetry/assistant/stream` (infra/nginx and
// the CLI's VPS vhost) forwards it unbuffered with a long read timeout.
// =============================================================================

@ApiTags('Telemetry')
@Controller('admin/telemetry')
@UseGuards(AiEnabledGuard)
export class TelemetryAssistantController {
  constructor(private readonly assistant: TelemetryAssistantService) {}

  @Post('assistant/stream')
  @Auth({ permissions: [PERMISSIONS.TELEMETRY_QUERY, PERMISSIONS.AI_USE] })
  @HttpCode(HttpStatus.OK)
  @ApiProduces('text/event-stream')
  @ApiOperation({
    summary: 'Ask the telemetry AI assistant a question (SSE)',
    description:
      'Turns a natural-language question into ONE read-only SQL query over the telemetry store, ' +
      'with an explanation. The assistant explores the store with three tools (`list_tables`, ' +
      '`describe_table`, `run_query`); every `run_query` goes through the same guard, row cap, ' +
      'timeout and audit trail as `POST /api/admin/telemetry/query` (audited as ' +
      '`telemetry:assistant_query`), and each turn is audited as `telemetry:assistant`. The AI ' +
      'call spends **your** key for the configured provider (or the organisation key, per the key ' +
      'policy). Query rows are shown to the model only when `telemetry.assistant.shareResults` ' +
      'is on, and never more than `telemetry.assistant.maxResultRowsToModel` (at most 100).\n\n' +
      '`history` carries up to 20 earlier turns of the conversation (oldest first, each at most ' +
      '8000 characters).\n\n' +
      '**Frames.** `event: <name>` plus `data: <json>`:\n' +
      '- `step` — `{ index, tool, input?: { table?, sql? }, rowCount?, truncated?, durationMs, error? }`, ' +
      'one per tool call (`index` is 0-based);\n' +
      '- `answer` — `{ sql: string | null, explanation }` (`sql` is null when the question cannot be ' +
      'answered from telemetry, or the suggested statement was not read-only);\n' +
      '- `error` — `{ code, message }` (an `AI_*` code, a `TELEMETRY_*` reason, or `INTERNAL_ERROR`);\n' +
      '- `done` — `{}`, always last.\n' +
      `A \`: ping\` comment is sent every ${AI_SSE_HEARTBEAT_MS / 1000} seconds.\n\n` +
      '**Errors before streaming** are ordinary JSON errors with `details.reason`: `AI_DISABLED` ' +
      '(403), `TELEMETRY_NOT_CONFIGURED` (503), `TELEMETRY_DISABLED` (409), ' +
      '`TELEMETRY_ASSISTANT_DISABLED` (409, `telemetry.assistant.enabled` is off), ' +
      '`TELEMETRY_ASSISTANT_NOT_CONFIGURED` (409, no provider/model selected).\n\n' +
      '**Cancel** by closing the connection: the AI call and any running query are aborted.',
  })
  @ApiOkResponse({
    description: 'An open event stream; it ends after `done`.',
    content: {
      'text/event-stream': {
        schema: {
          type: 'string',
          example:
            'event: step\ndata: {"index":0,"tool":"list_tables","durationMs":12}\n\n' +
            'event: step\ndata: {"index":1,"tool":"run_query","input":{"sql":"SELECT count(*) AS spans FROM opentelemetry_traces"},"rowCount":1,"truncated":false,"durationMs":40}\n\n' +
            ': ping\n\n' +
            'event: answer\ndata: {"sql":"SELECT count(*) AS spans FROM opentelemetry_traces","explanation":"Counts every span."}\n\n' +
            'event: done\ndata: {}\n\n',
        },
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Validation error', type: ErrorDto })
  @ApiResponse({
    status: 403,
    description: '`AI_DISABLED`, or missing `telemetry:query` / `ai:use`',
    type: ErrorDto,
  })
  @ApiResponse({
    status: 409,
    description: '`TELEMETRY_DISABLED`, `TELEMETRY_ASSISTANT_DISABLED`, `TELEMETRY_ASSISTANT_NOT_CONFIGURED`',
    type: ErrorDto,
  })
  @ApiResponse({ status: 503, description: '`TELEMETRY_NOT_CONFIGURED`', type: ErrorDto })
  async stream(
    @Body() dto: TelemetryAssistantRequestDto,
    @CurrentUser('id') userId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const disconnect = abortOnDisconnect(reply.raw);
    const sse = openTelemetrySse(reply, disconnect);

    try {
      // Throws (before any event) only for the preconditions: the global filter answers those as JSON.
      await this.assistant.stream(userId, dto, { signal: disconnect.signal, emit: sse.send });
    } catch (err) {
      if (!sse.opened) {
        disconnect.dispose();
        throw err;
      }

      // Not expected (the service reports failures in band); close the stream cleanly.
      sse.send('error', { code: 'INTERNAL_ERROR', message: 'The telemetry assistant failed unexpectedly.' });
      sse.send('done', {});
    } finally {
      if (sse.opened) sse.close();
    }
  }
}
