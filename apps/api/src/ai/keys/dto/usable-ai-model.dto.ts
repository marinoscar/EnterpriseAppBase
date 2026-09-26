import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { aiModelCapabilitiesSchema } from '../../core/capabilities';

// =============================================================================
// GET /api/ai/models — the models the caller can call right now (issue #431)
// =============================================================================
//
// usable(user) = admin-enabled, non-deprecated models
//                ∩ reachable with the user's own key          (keySource 'user')
//              — or every admin-enabled, non-deprecated model
//                when the org fallback serves the provider     (keySource 'org')
//
// docs/specs/ai-platform.md §7. Carries no key, no hint and no catalog
// provenance — only what a model picker needs.
// =============================================================================

export const AI_KEY_SOURCES = ['user', 'org'] as const;

export const usableAiModelSchema = z.object({
  provider: z.string(),
  /** The provider's own model id — what a request's `model` names. */
  modelId: z.string(),
  displayName: z.string().nullable(),
  /** What the model can do. An unclassified model reports empty lists. */
  capabilities: aiModelCapabilitiesSchema,
  /** Whose key would pay for a call: the caller's own, or the organisation's fallback. */
  keySource: z.enum(AI_KEY_SOURCES),
});

export class UsableAiModelDto extends createZodDto(usableAiModelSchema) {}
export type UsableAiModel = z.infer<typeof usableAiModelSchema>;
