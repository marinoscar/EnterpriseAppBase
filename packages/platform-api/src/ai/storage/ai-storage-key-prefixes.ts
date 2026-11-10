// =============================================================================
// The AI slice's object-storage key prefix (issue #739)
// =============================================================================
//
// `ai-outputs/` is the AI slice's own: it declares it here and
// `AiModule.forRoot()` registers it with the storage slice's key-prefix
// registry (`@marinoscar/platform-api/storage`), so the storage purge
// (`allKeyPrefixes()`) knows every object an AI operation wrote. Registering
// is idempotent: an app manifest that already registered this exact
// definition (to keep its purge order) makes the call a no-op.
// =============================================================================

import { registerStorageKeyPrefixes, storageKeyPrefixRegistry, type StorageKeyPrefixDef } from '../../storage/index';
import { AI_OUTPUTS_KEY_PREFIX } from './ai-output-writer';

/**
 * The AI slice's key-prefix registrations: `ai-outputs` (owner `ai`,
 * user-scoped: `ai-outputs/<userId>/<runId>/`).
 *
 * @stability experimental
 */
export const AI_STORAGE_KEY_PREFIXES: readonly StorageKeyPrefixDef[] = Object.freeze([
  Object.freeze({
    id: 'ai-outputs',
    prefix: AI_OUTPUTS_KEY_PREFIX,
    owner: 'ai',
    scope: 'user' as const,
    description: 'Files an AI operation produced for a user, under ai-outputs/<userId>/<runId>/.',
  }),
]);

/**
 * Registers {@link AI_STORAGE_KEY_PREFIXES} unless they are registered
 * already or the registry is frozen. Called by `AiModule.forRoot()`.
 *
 * @stability experimental
 */
export function registerAiStorageKeyPrefixes(): void {
  if (AI_STORAGE_KEY_PREFIXES.every((def) => storageKeyPrefixRegistry.has(def.id))) return;
  if (storageKeyPrefixRegistry.frozen) return;
  registerStorageKeyPrefixes(AI_STORAGE_KEY_PREFIXES);
}
