// =============================================================================
// The AI capability and operation vocabularies on the wire (PP-14.17, #935)
// =============================================================================
//
// `GET /api/admin/ai/capabilities` lists every capability and operation the
// deployment knows: the platform's own and the ones an app registered with
// `registerAiCapability` / `registerAiOperation` (`@marinoscar/platform-api/ai`).
// The admin pages draw their capability labels from it, so an app capability
// needs no web change.
// =============================================================================

import { z } from 'zod';

import { AI_CAPABILITY_ID_PATTERN, AI_FEATURE_ID_PATTERN, AI_OPERATION_ID_PATTERN } from './constants.js';

/**
 * A capability id on the wire. Open: any `AI_CAPABILITY_ID_PATTERN` string, never
 * `z.enum(BUILTIN_AI_CAPABILITIES)`.
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const aiCapabilityIdSchema = z.string().regex(AI_CAPABILITY_ID_PATTERN);

/**
 * An operation id on the wire (the `operation` of a usage row). Open: any
 * `AI_OPERATION_ID_PATTERN` string.
 *
 * @extensionPoint schema
 * @stability experimental
 */
export const aiOperationIdSchema = z.string().regex(AI_OPERATION_ID_PATTERN);

/**
 * A feature id on the wire (the `feature` of a usage row or a run).
 *
 * @stability experimental
 */
export const aiFeatureIdSchema = z.string().regex(AI_FEATURE_ID_PATTERN);

/**
 * One capability, as `GET /api/admin/ai/capabilities` lists it.
 *
 * @stability experimental
 */
export const aiCapabilityDescriptorSchema = z.object({
  /** The capability id (`audio_transcription`). */
  id: aiCapabilityIdSchema,
  /** The short label the admin pages show (`Transcription`). */
  label: z.string(),
  /** One sentence on what a model with it can do. */
  description: z.string(),
  /** Whether the platform ships it (`false`: an app or package registered it). */
  builtin: z.boolean(),
});

/**
 * One operation, as `GET /api/admin/ai/capabilities` lists it.
 *
 * @stability experimental
 */
export const aiOperationDescriptorSchema = z.object({
  /** The operation id (`audio.transcribe`), the `operation` of its usage rows. */
  id: aiOperationIdSchema,
  /** The label usage reports show. */
  label: z.string(),
  /** The model capability an operation needs. */
  capability: aiCapabilityIdSchema,
  /** Whether the platform ships it. */
  builtin: z.boolean(),
  /** Whether `AiService.forUser(...).run(id, input)` can run it (an app operation with schemas). */
  runnable: z.boolean(),
});

/**
 * The body of `GET /api/admin/ai/capabilities`.
 *
 * @stability experimental
 */
export const aiCapabilitiesResponseSchema = z.object({
  /** Every registered capability, built-ins first, then registration order. */
  capabilities: z.array(aiCapabilityDescriptorSchema),
  /** Every registered operation, built-ins first, then registration order. */
  operations: z.array(aiOperationDescriptorSchema),
});

/**
 * A cost the deployment's pricing port computed (`AI_PRICING`): an amount in
 * a currency, never a rate card.
 *
 * @stability experimental
 */
export const aiUsageCostSchema = z.object({
  /** The amount, in `currency`'s major unit. */
  amount: z.number(),
  /** An ISO 4217 code (`USD`) or any short label the pricing port uses. */
  currency: z.string().min(1).max(8),
});

/** One capability on the wire. @stability experimental */
export type AiCapabilityDescriptor = z.infer<typeof aiCapabilityDescriptorSchema>;
/** One operation on the wire. @stability experimental */
export type AiOperationDescriptor = z.infer<typeof aiOperationDescriptorSchema>;
/** The capabilities response. @stability experimental */
export type AiCapabilitiesResponse = z.infer<typeof aiCapabilitiesResponseSchema>;
/** A computed cost. @stability experimental */
export type AiUsageCost = z.infer<typeof aiUsageCostSchema>;
