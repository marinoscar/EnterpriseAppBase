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
  id: z.string(),
  label: z.string(),
  group: z.string().nullable(),
  needs: z.array(z.string()),
  inputModalities: z.array(z.string()),
  providers: z.array(z.string()).nullable(),
  requiresHostedTools: z.array(z.string()),
  defaultEffort: z.string().nullable(),
  usable: z.boolean(),
});

/**
 * One registered AI feature on the wire.
 *
 * @stability experimental
 */
export type AiFeatureView = z.infer<typeof aiFeatureViewSchema>;
