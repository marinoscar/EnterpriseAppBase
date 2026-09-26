import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { AI_RUN_STATUSES } from '../../runtime/ai-runtime.types';

// =============================================================================
// AI consumer API — response shapes (issue #433, epic #419)
// =============================================================================
//
// Documentation schemas for the provider-neutral `AiResponse`
// (`core/types/responses.types.ts`) and the background-run views. The
// controller returns the facade's objects as they are; these schemas describe
// them for the OpenAPI document.
//
// ⚠ None of these has a field able to carry a key. `ai-responses.integration
// .spec.ts` serialises every response body and every SSE frame and searches
// them for the user's and the organisation's key.
// =============================================================================

export const aiOutputItemSchema = z.union([
  z.object({ type: z.literal('message'), text: z.string() }),
  z.object({ type: z.literal('reasoning'), summary: z.array(z.string()) }),
  z.object({
    type: z.literal('function_call'),
    callId: z.string(),
    name: z.string(),
    arguments: z.string(),
  }),
  z.object({
    type: z.literal('hosted_tool_call'),
    tool: z.string(),
    status: z.string(),
    result: z.unknown().optional(),
  }),
]);

export const aiUsageSchema = z.object({
  inputTokens: z.number().int().optional(),
  outputTokens: z.number().int().optional(),
  reasoningTokens: z.number().int().optional(),
  cachedInputTokens: z.number().int().optional(),
});

export const aiResponseSchema = z.object({
  /** The provider's response id — pass it back as `previousResponseId` to chain. */
  id: z.string(),
  provider: z.string(),
  model: z.string(),
  output: z.array(aiOutputItemSchema),
  /** Every `message` item's text, concatenated in order. */
  outputText: z.string(),
  /** Present only when the request carried `structuredOutput` — already validated against it. */
  parsed: z.unknown().optional(),
  usage: aiUsageSchema,
  finishReason: z.enum(['stop', 'length', 'tool_calls', 'content_filter', 'error']),
  providerRequestId: z.string().optional(),
});

export class AiResponseDto extends createZodDto(aiResponseSchema) {}

/** `POST /api/ai/runs` — 202. */
export const aiRunStartedSchema = z.object({
  /** Poll `GET /api/ai/runs/{runId}`. */
  runId: z.uuid(),
  /** The queue job executing it (`ai.response.run`, or `ai.image.generate` for an image run). */
  jobId: z.uuid(),
});

export class AiRunStartedDto extends createZodDto(aiRunStartedSchema) {}

/** `GET /api/ai/runs/{id}` and `POST /api/ai/runs/{id}/cancel`. */
/**
 * A succeeded image run's `output` (#437): the storage objects it created,
 * owned by the caller. Download each with
 * `GET /api/storage/objects/{id}/download`; the image bytes are never here.
 */
export const aiImageRunOutputSchema = z.object({
  type: z.literal('images'),
  provider: z.string(),
  model: z.string(),
  /** One storage object per image, in the order the provider returned them. */
  storageObjectIds: z.array(z.uuid()),
  images: z.array(
    z.object({
      storageObjectId: z.uuid(),
      mimeType: z.string(),
      /** Bytes. */
      size: z.number().int(),
      /** The prompt the provider actually used, where it rewrote it. */
      revisedPrompt: z.string().optional(),
    }),
  ),
  usage: aiUsageSchema,
});

export const aiRunSchema = z.object({
  id: z.uuid(),
  status: z.enum(AI_RUN_STATUSES),
  provider: z.string(),
  modelId: z.string(),
  /**
   * Once `succeeded`: the completed response, or — for an image run
   * (`type: "images"`) — the storage objects it created. Otherwise null.
   */
  output: z.union([aiResponseSchema, aiImageRunOutputSchema]).nullable(),
  /** The AI error code (e.g. `AI_KEY_REQUIRED`) once `failed`; otherwise null. */
  errorCode: z.string().nullable(),
  /** A safe, generic description of the failure; never provider output. */
  errorMessage: z.string().nullable(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
});

export class AiRunDto extends createZodDto(aiRunSchema) {}
export type AiRunHttpView = z.input<typeof aiRunSchema>;
