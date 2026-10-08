// =============================================================================
// The AI feature registry: registerAiFeature (issue #739, rung 2)
// =============================================================================
//
// An app's AI feature (a coach chat, a summary, a photo reading) declares
// itself once, at import time, with what it needs from a model. A call made
// for it, `AiService.forUser(userId, { feature })`, is then:
//
//   - routed through `AI_TARGET_RESOLVER` with the feature id (an app's
//     resolver can map feature -> model),
//   - refused with AI_INVALID_REQUEST when the feature is not registered, or
//     when the chosen model lacks one of the feature's `needs` or
//     `inputModalities`, or is on a provider outside its `providers`,
//   - recorded as the span attribute `ai.feature`.
//
// The feature id is never persisted as a column. `GET /api/ai/features` lists
// the registry with, per feature, whether the caller has a usable model.
// =============================================================================

import { defineRegistry, type Registry } from '../../core/index';
import { AI_CAPABILITIES, AI_INPUT_MODALITIES, type AiCapability, type AiInputModality } from '../core/capabilities';

/** A feature id: lower snake case, starting with a letter (`coach_chat`). */
const FEATURE_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;

/**
 * One AI feature of an app.
 *
 * @stability experimental
 */
export interface AiFeatureDefinition {
  /** Stable id, lower snake case (`coach_chat`). Never reuse one for something else. */
  readonly id: string;
  /** What the UI calls it. */
  readonly label: string;
  /** Free text for UI grouping. */
  readonly group?: string;
  /** The model capabilities every call for it needs (`['responses', 'structured_output']`). */
  readonly needs: readonly AiCapability[];
  /** The input modalities the model must accept (`['image']` for a photo reading). */
  readonly inputModalities?: readonly AiInputModality[];
  /** Provider allow-list; `null` or absent means any provider. */
  readonly providers?: readonly string[] | null;
  /** Hosted tools the feature relies on (`web_search`); informational for the UI and the resolver. */
  readonly requiresHostedTools?: readonly string[];
  /** The reasoning effort the feature defaults to, when it has one. */
  readonly defaultEffort?: string | null;
}

/**
 * Every registered AI feature, in registration order. Read it; register with
 * {@link registerAiFeature}.
 *
 * @stability experimental
 */
export const aiFeatureRegistry: Registry<AiFeatureDefinition> = defineRegistry<AiFeatureDefinition>({
  name: 'ai-features',
  idOf: (def) => def.id,
  idPattern: FEATURE_ID_PATTERN,
  validate: (def) => {
    if (typeof def.label !== 'string' || def.label.trim() === '') throw new Error('label is required');
    if (!Array.isArray(def.needs) || def.needs.length === 0) throw new Error('needs must name at least one capability');
    for (const need of def.needs) {
      if (!(AI_CAPABILITIES as readonly string[]).includes(need)) throw new Error(`unknown capability "${String(need)}"`);
    }
    for (const modality of def.inputModalities ?? []) {
      if (!(AI_INPUT_MODALITIES as readonly string[]).includes(modality)) {
        throw new Error(`unknown input modality "${String(modality)}"`);
      }
    }
    if (def.providers !== undefined && def.providers !== null && def.providers.length === 0) {
      throw new Error('providers must be null (any) or name at least one provider');
    }
  },
});

/**
 * Declares an AI feature. Call it at import time from the app's manifest,
 * before the application bootstraps (the registry freezes then).
 *
 * @param def - the feature: id, label and what it needs from a model.
 * @throws RegistryError `DUPLICATE_ID`, `INVALID_ID`, `INVALID_ENTRY` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerAiFeature({ id: 'example_summary', label: 'Summaries', needs: ['responses'] });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAiFeature(def: AiFeatureDefinition): void {
  aiFeatureRegistry.register(def);
}

/**
 * The registered feature, or `undefined`.
 *
 * @param id - the feature id.
 *
 * @stability experimental
 */
export function getAiFeature(id: string): AiFeatureDefinition | undefined {
  return aiFeatureRegistry.get(id);
}

/**
 * Every registered feature, in registration order.
 *
 * @stability experimental
 */
export function listAiFeatures(): AiFeatureDefinition[] {
  return aiFeatureRegistry.list();
}
