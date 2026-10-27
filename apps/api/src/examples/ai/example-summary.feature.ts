// =============================================================================
// Reference example: a registered AI feature (issue #739, rung 2)
// =============================================================================
//
// `registerAiFeature` declares what an app feature needs from a model. Calls
// made for it (`AiService.forUser(userId, { feature: 'example_summary' })`)
// are routed through `AI_TARGET_RESOLVER` with the feature id, refused with
// AI_INVALID_REQUEST on a model lacking `needs`, and carry the `ai.feature`
// span attribute and metric label. `GET /api/ai/features` lists it.
//
// Registered at import time (the registry freezes at bootstrap), by the
// examples module.
// =============================================================================

import { registerAiFeature, type AiFeatureDefinition } from '@marinoscar/platform-api/ai';

/** The example feature's id. Stable: never reuse it for something else. */
export const EXAMPLE_SUMMARY_FEATURE_ID = 'example_summary';

/** One short summary of a text: any model that answers responses. */
export const EXAMPLE_SUMMARY_FEATURE: AiFeatureDefinition = {
  id: EXAMPLE_SUMMARY_FEATURE_ID,
  label: 'Example: summaries',
  group: 'Examples',
  needs: ['responses'],
  inputModalities: ['text'],
  providers: null,
};

registerAiFeature(EXAMPLE_SUMMARY_FEATURE);
