import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { AI_KEY_POLICIES } from '../../../common/schemas/settings.schema';

// =============================================================================
// PUT /api/admin/ai/config — body (issue #428, epic #419)
// =============================================================================
//
// The whole `ai` namespace, in a shape a form can send back unchanged:
// `providers` is keyed by provider id (the admin view lists them as an array
// with more fields; only `enabled` and `baseUrl` are writable).
//
// There is NO key field here and there must never be one. The admin key has
// its own routes (`PUT`/`DELETE /api/admin/ai/providers/:provider/key`) so it
// is verified against the provider before it is stored, and so a settings save
// can never carry, echo or audit it.
// =============================================================================

/** Largest accepted provider id — generous; real ids are short. */
const PROVIDER_ID_MAX = 64;

export const aiProviderSettingsInputSchema = z.object({
  enabled: z.boolean(),
  /**
   * Endpoint override for an OpenAI-compatible gateway. Omit (or send null /
   * empty) for "no override". ⚠ An override that is already stored cannot be
   * cleared through this route yet — see `AiConfigAdminService.replace`.
   */
  baseUrl: z
    .union([z.url().max(2048), z.literal('')])
    .nullish(),
});

export const updateAiConfigSchema = z.object({
  enabled: z.boolean(),
  keyPolicy: z.enum(AI_KEY_POLICIES),
  logPromptContent: z.boolean(),
  defaults: z.object({
    /** Omit or null for "no cap". ⚠ A stored cap cannot be cleared yet — see `baseUrl`. */
    maxOutputTokensCap: z.number().int().positive().max(1_000_000).nullish(),
    allowBackgroundRuns: z.boolean(),
  }),
  /**
   * Per-provider settings keyed by provider id. A provider left out keeps its
   * stored settings.
   */
  providers: z.record(
    z.string().min(1).max(PROVIDER_ID_MAX),
    aiProviderSettingsInputSchema,
  ),
});

export class UpdateAiConfigDto extends createZodDto(updateAiConfigSchema) {}
export type UpdateAiConfigInput = z.output<typeof updateAiConfigSchema>;
