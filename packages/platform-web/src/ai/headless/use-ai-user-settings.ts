// The caller's AI preferences (issue #890): `user_settings.ai.defaultModel`,
// read and written through the settings slice's `useUserSettings` (GET and
// PATCH `/user-settings`). The AI pages never edit the theme, so loading the
// document never pushes the stored theme into the shell (`syncTheme: false`).

import { useUserSettings } from '../../settings/index.js';
import type {
  UseUserSettingsResult,
  UserSettingsDocument,
  UserSettingsUpdateBase,
} from '../../settings/index.js';
import type { AiHookOptions } from './use-ai-api.js';
import type { AiDefaultModel } from './types.js';

/**
 * The part of the user settings document the AI pages read: the default
 * model, a provider/model pair and never a key.
 *
 * @stability experimental
 */
export interface AiUserSettings extends UserSettingsDocument {
  /** `ai.defaultModel`: `null` or absent means "no default chosen". */
  ai?: {
    /** The default model. */
    defaultModel?: AiDefaultModel | null;
  };
}

/**
 * The PATCH body the AI pages send.
 *
 * @stability experimental
 */
export interface AiUserSettingsUpdate extends UserSettingsUpdateBase {
  /** A new default model, or `null` to clear it. */
  ai?: {
    /** The default model. */
    defaultModel?: AiDefaultModel | null;
  };
}

/**
 * The user settings document, for its `ai.defaultModel`.
 *
 * @param options - the transport.
 * @returns the settings hook's state and actions.
 *
 * @stability experimental
 */
export function useAiUserSettings(
  options: AiHookOptions = {}
): UseUserSettingsResult<AiUserSettings, AiUserSettingsUpdate> {
  return useUserSettings<AiUserSettings, AiUserSettingsUpdate>({
    ...(options.api === undefined ? {} : { api: options.api }),
    syncTheme: false,
  });
}
