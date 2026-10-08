// =============================================================================
// User settings namespace `ai` (issue #677; namespace #423, epic #419, umbrella #418)
// =============================================================================
//
// Declaration file: pure data, imports only leaf modules. Registered by
// `settings/registry/user-settings.manifest.ts`. Recipe:
// `settings/registry/README.md`. The merge moved verbatim from
// `UserSettingsService.mergeAi`.
//
// NON-SECRET ONLY: a user's own provider key is `UserAiKey.secret`, in its own
// table, never here. See `userAiSettingsSchema` for the full argument.
// =============================================================================

import {
  userAiSettingsPatchSchema,
  userAiSettingsSchema,
  type UserAiSettingsPatchValue,
  type UserAiSettingsValue,
} from '../common/schemas/settings.schema';
import type { UserSettingsNamespace } from '@marinoscar/platform-api/settings';

export const AI_USER_SETTINGS = {
  key: 'ai',
  description: 'Per-user AI preferences: which (provider, model) an AI surface pre-selects.',
  schema: userAiSettingsSchema,
  // The outer `.nullable()` clears the whole `ai` namespace (back to "no
  // default model, no other AI preference set"); the inner nullability on
  // `defaultModel` (see `userAiSettingsPatchSchema`) is what lets
  // `{ "ai": { "defaultModel": null } }` clear just the selection while
  // leaving the namespace itself present. Same two-level shape
  // `dataTablesPatchSchema` uses.
  patchSchema: userAiSettingsPatchSchema,
  // The documented response (`userSettingsResponseSchema`) has never declared
  // `ai`, although `GET /api/user-settings` returns it. Kept `null` so the
  // OpenAPI document is unchanged by #677.
  responseSchema: null,
  /**
   * Merge the `ai` namespace (#423, epic #419, umbrella #418).
   *
   * - patch absent  -> keep the stored namespace untouched
   * - patch is `null` -> clear the whole namespace (back to "no default
   *   model chosen", the same state an untouched account is in)
   * - patch is an object -> REPLACES the namespace wholesale. Unlike
   *   `dataTables`/`navigation`, there is only one field
   *   (`defaultModel`, a single (provider, modelId) pair) and
   *   `userAiSettingsPatchSchema` makes it REQUIRED-BUT-NULLABLE, not
   *   independently optional — so whenever a caller sends `ai` at all, it
   *   already states the field in full (an object, or `null` to clear just
   *   the selection while keeping the namespace present). There is no
   *   "field omitted" case to merge field-by-field the way `navigation
   *   .railCollapsed` has.
   */
  merge(current: UserAiSettingsValue | undefined, patch: UserAiSettingsPatchValue | null | undefined) {
    if (patch === undefined) {
      return current;
    }

    if (patch === null) {
      return undefined;
    }

    return { defaultModel: patch.defaultModel };
  },
} satisfies UserSettingsNamespace<'ai', UserAiSettingsValue, UserAiSettingsPatchValue>;

declare module '@marinoscar/platform-api/settings' {
  interface UserSettingsNamespaces {
    /**
     * AI preferences (#423, epic #419, umbrella #418): which (provider, model)
     * an AI surface should pre-select. Absent means "no default model chosen"
     * — the same sparse-optional contract every namespace follows, so an
     * untouched account is not materialised with a preference nobody set.
     */
    ai: UserAiSettingsValue;
  }
  interface UserSettingsNamespaceDeclarations {
    ai: typeof AI_USER_SETTINGS;
  }
}
