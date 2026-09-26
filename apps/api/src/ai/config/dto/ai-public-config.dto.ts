import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

import { AI_KEY_POLICIES } from '../../../common/schemas/settings.schema';

// =============================================================================
// GET /api/ai/config — response (issue #428, epic #419)
// =============================================================================
//
// What a signed-in user's browser needs to know about this deployment's AI
// platform, and nothing else — the `/api/notifications/config` pattern (see
// `notifications/dto/notification-config.dto.ts` for why a narrow projection
// beats widening `system_settings:read`, which the seeded Viewer and
// Contributor roles do not hold and which would hand them the whole settings
// document).
//
// It carries no key, no hint, no base URL and no admin provenance. While AI is
// off it carries no provider list either: the UI hides every AI surface, and a
// list of what would be available is not something it needs.
// =============================================================================

export const aiPublicProviderSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  /** Enabled in settings AND an adapter is registered in this deployment. */
  enabled: z.boolean(),
  /**
   * Whether an admin (org) key is stored for this provider. Whether it can
   * actually serve THIS user is a function of `keyPolicy`: only under
   * `byok_with_org_fallback`.
   */
  hasOrgKey: z.boolean(),
});

export const aiPublicConfigSchema = z.object({
  /** The platform kill switch. When false, hide every AI surface. */
  enabled: z.boolean(),
  keyPolicy: z.enum(AI_KEY_POLICIES),
  /**
   * `ai.defaults.allowBackgroundRuns` — whether `POST /api/ai/runs` accepts a
   * request (#433). Always false while `enabled` is false.
   */
  allowBackgroundRuns: z.boolean(),
  /** Every registered provider; empty while `enabled` is false. */
  providers: z.array(aiPublicProviderSchema),
});

export class AiPublicConfigDto extends createZodDto(aiPublicConfigSchema) {}
export type AiPublicConfig = z.infer<typeof aiPublicConfigSchema>;
