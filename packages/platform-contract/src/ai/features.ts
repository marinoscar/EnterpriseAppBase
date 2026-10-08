// The wire shape of `GET /api/ai/features` (issue #739): every AI feature an
// app registered (`registerAiFeature` of `@marinoscar/platform-api/ai`) and,
// per feature, whether the caller has a usable model for it right now.

import { z } from 'zod';

/**
 * One registered AI feature, as `GET /api/ai/features` lists it.
 *
 * @stability experimental
 */
export const aiFeatureViewSchema = z.object({
  /** The feature id (`registerAiFeature`). */
  id: z.string(),
  /** Its display label. */
  label: z.string(),
  /** Its group, for a picker. */
  group: z.string().nullable(),
  /** The capabilities a model must declare. */
  needs: z.array(z.string()),
  /** The input modalities a model must read. */
  inputModalities: z.array(z.string()),
  /** The providers a model must be from; `null` means any. */
  providers: z.array(z.string()).nullable(),
  /** The hosted tools a model must run. */
  requiresHostedTools: z.array(z.string()),
  /** The reasoning effort the feature asks for, if any. */
  defaultEffort: z.string().nullable(),
  /** Whether the caller has a usable model for it right now. */
  usable: z.boolean(),
});

/**
 * One registered AI feature on the wire.
 *
 * @stability experimental
 */
export type AiFeatureView = z.infer<typeof aiFeatureViewSchema>;
