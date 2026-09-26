import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { AI_KEY_POLICIES } from '../../../common/schemas/settings.schema';
import { AI_CAPABILITIES } from '../../core/capabilities';

// =============================================================================
// GET /api/admin/ai/config — response (issue #428, epic #419)
// =============================================================================
//
// The `ai` settings namespace joined, per provider, with the MASKED status of
// that provider's admin (org) key. The key itself is never in this shape: it is
// held in the encrypted credential store and `keyStatus` is built from
// `CredentialsService.describe`, which cannot decrypt anything.
// =============================================================================

/** Masked, non-secret facts about a stored admin key. Mirrors storage's `secretStatus`. */
export const aiKeyStatusSchema = z.object({
  /** Whether an admin key is stored for this provider. */
  configured: z.boolean(),
  /** A masked hint (`••••Xk9q`) so an admin can tell two keys apart. Never the key. */
  hint: z.string().nullable(),
  updatedAt: z.iso.datetime().nullable(),
  updatedByUserId: z.string().nullable(),
});

export const aiAdminProviderSchema = z.object({
  /** Stable provider id (`openai`). */
  id: z.string(),
  /** The adapter's display name, or the id when no adapter is registered. */
  displayName: z.string(),
  /**
   * Whether an adapter for this provider is registered in this process. A
   * provider can have a settings slot and no adapter (a fork removed it), in
   * which case it cannot be enabled.
   */
  registered: z.boolean(),
  /** The `ai.providers.<id>.enabled` switch, as stored. */
  enabled: z.boolean(),
  /** Endpoint override for OpenAI-compatible gateways, or null for the provider default. */
  baseUrl: z.string().nullable(),
  keyStatus: aiKeyStatusSchema,
  /** Capabilities the provider's ADAPTER supports (derived from its ports), not any one model's. */
  supportedCapabilities: z.array(z.enum(AI_CAPABILITIES)),
});

export const aiConfigResponseSchema = z.object({
  /** The platform kill switch. */
  enabled: z.boolean(),
  keyPolicy: z.enum(AI_KEY_POLICIES),
  logPromptContent: z.boolean(),
  defaults: z.object({
    /** Deployment-wide output-token cap, or null for none. */
    maxOutputTokensCap: z.number().int().nullable(),
    allowBackgroundRuns: z.boolean(),
  }),
  /** Registered providers ∪ providers with a settings slot. */
  providers: z.array(aiAdminProviderSchema),
  /** The system-settings row version — send it back as `If-Match` on `PUT`. `0` when nothing is stored yet. */
  version: z.number().int(),
  updatedAt: z.iso.datetime().nullable(),
  updatedBy: z.object({ id: z.string(), email: z.string() }).nullable(),
});

export class AiConfigResponseDto extends createZodDto(aiConfigResponseSchema) {}
export type AiConfigResponse = z.infer<typeof aiConfigResponseSchema>;
export type AiAdminProvider = z.infer<typeof aiAdminProviderSchema>;

/** Warning codes the key-removal response can carry. */
export const AI_KEY_REMOVAL_WARNINGS = ['ORG_FALLBACK_WITHOUT_KEY'] as const;

/**
 * `DELETE /api/admin/ai/providers/:provider/key` — the admin view, plus
 * `warnings`. `ORG_FALLBACK_WITHOUT_KEY` means the deployment's key policy is
 * still `byok_with_org_fallback`, so users without their own key now have no
 * key at all for this provider.
 */
export const aiKeyRemovalResponseSchema = aiConfigResponseSchema.extend({
  warnings: z.array(z.enum(AI_KEY_REMOVAL_WARNINGS)),
});

export class AiKeyRemovalResponseDto extends createZodDto(aiKeyRemovalResponseSchema) {}
export type AiKeyRemovalResponse = z.infer<typeof aiKeyRemovalResponseSchema>;
