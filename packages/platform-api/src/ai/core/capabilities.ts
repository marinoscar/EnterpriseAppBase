// =============================================================================
// AI capabilities (issue #424, epic #419)
// =============================================================================
//
// The closed vocabulary every other AI story speaks: the catalog (#429) stores
// an `AiModelCapabilities` per model, the admin UI renders it as chips, and the
// runtime gate pipeline (#431) refuses a request whose shape needs a
// capability the chosen model does not declare.
//
// TWO LEVELS, deliberately not conflated:
//
//   - MODEL level (this file): what one model can do. Declared by the
//     adapter's `classifyModel()` and overridable by an administrator.
//   - PROVIDER level (`AiProviderRegistry.supports()`): which capability
//     PORTS the adapter implements at all. Derived from port presence, never
//     declared, so it cannot drift from the code.
//
// A request needs both: the provider must carry the port, and the model must
// declare the capability.
// =============================================================================

import { z } from 'zod';

/**
 * Every capability a model can declare. Permanent strings — they are stored
 * in the catalog table and in administrator overrides, so renaming one is a
 * data migration, not a refactor.
 *
 * @stability experimental
 */
export const AI_CAPABILITIES = [
  'responses',
  'reasoning',
  'tools',
  'hosted_tools',
  'structured_output',
  'streaming',
  'vision_input',
  'file_input',
  'image_generation',
  'image_edit',
  'audio_transcription',
  'audio_speech',
  'embeddings',
  'realtime',
] as const;

/**
 * One of {@link AI_CAPABILITIES}.
 *
 * @stability experimental
 */
export type AiCapability = (typeof AI_CAPABILITIES)[number];

/**
 * What a model can read.
 *
 * @stability experimental
 */
export const AI_INPUT_MODALITIES = ['text', 'image', 'audio', 'file'] as const;

/**
 * What a model can produce.
 *
 * @stability experimental
 */
export const AI_OUTPUT_MODALITIES = ['text', 'image', 'audio', 'embedding'] as const;

/**
 * How hard a reasoning model may be asked to think.
 *
 * @stability experimental
 */
export const AI_REASONING_EFFORTS = ['minimal', 'low', 'medium', 'high'] as const;

/**
 * One of {@link AI_INPUT_MODALITIES}.
 *
 * @stability experimental
 */
export type AiInputModality = (typeof AI_INPUT_MODALITIES)[number];

/**
 * One of {@link AI_OUTPUT_MODALITIES}.
 *
 * @stability experimental
 */
export type AiOutputModality = (typeof AI_OUTPUT_MODALITIES)[number];

/**
 * One of {@link AI_REASONING_EFFORTS}.
 *
 * @stability experimental
 */
export type AiReasoningEffort = (typeof AI_REASONING_EFFORTS)[number];

/**
 * The entries of the capability enum (`z.enum(AI_CAPABILITIES)`).
 *
 * @stability experimental
 */
export type AiCapabilityEnum = { [K in AiCapability]: K };

/**
 * The entries of the input-modality enum.
 *
 * @stability experimental
 */
export type AiInputModalityEnum = { [K in AiInputModality]: K };

/**
 * The entries of the output-modality enum.
 *
 * @stability experimental
 */
export type AiOutputModalityEnum = { [K in AiOutputModality]: K };

/**
 * The entries of the reasoning-effort enum.
 *
 * @stability experimental
 */
export type AiReasoningEffortEnum = { [K in AiReasoningEffort]: K };

/**
 * What one model can do. Validated with this schema wherever it crosses a
 * trust boundary (an adapter's classifier output, an administrator override,
 * a JSONB column read back from the database).
 *
 * @stability experimental
 */
export const aiModelCapabilitiesSchema = z.object({
  /** The capabilities the model declares. */
  capabilities: z.array(z.enum(AI_CAPABILITIES) as z.ZodEnum<AiCapabilityEnum>),
  /** What it reads. */
  inputModalities: z.array(z.enum(AI_INPUT_MODALITIES) as z.ZodEnum<AiInputModalityEnum>),
  /** What it produces. */
  outputModalities: z.array(z.enum(AI_OUTPUT_MODALITIES) as z.ZodEnum<AiOutputModalityEnum>),
  /** The reasoning efforts it accepts, for a `reasoning` model. */
  reasoningEfforts: z.array(z.enum(AI_REASONING_EFFORTS) as z.ZodEnum<AiReasoningEffortEnum>).optional(),
  /** The context window in tokens, when known. */
  contextWindow: z.number().int().positive().optional(),
  /** The output-token ceiling, when known. */
  maxOutputTokens: z.number().int().positive().optional(),
  /**
   * The voices an `audio_speech` model speaks in (#439) — surfaced through
   * `GET /api/ai/models` so a picker can offer them. Optional: absent means
   * "the provider's own list" (`AiAudioPort.voices`).
   */
  voices: z.array(z.string().min(1).max(64)).max(100).optional(),
});

/**
 * What one model can do (`aiModelCapabilitiesSchema`'s output).
 *
 * @stability experimental
 */
export type AiModelCapabilities = z.infer<typeof aiModelCapabilitiesSchema>;

/**
 * Type guard for an arbitrary string read from the database or a request.
 *
 * @param value - the string.
 * @returns whether it is one of {@link AI_CAPABILITIES}.
 *
 * @stability experimental
 */
export function isAiCapability(value: string): value is AiCapability {
  return (AI_CAPABILITIES as readonly string[]).includes(value);
}
