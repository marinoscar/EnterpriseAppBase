// The wire shapes of `/api/admin/ai/org-keys` (issue #739): an organization's
// own AI provider keys. Write-only: no response shape has a field able to
// carry a key, only whether one is stored and its last characters.

import { z } from 'zod';

import { ORG_AI_KEY_MAX, ORG_AI_KEY_MIN, type KeyMaterialFieldNames } from './constants.js';

/**
 * `PUT /api/admin/ai/org-keys/:provider`. The key is verified with the
 * provider first and stored only when it passes; it is never returned.
 *
 * @stability experimental
 */
export const setOrgAiKeySchema = z.object({
  /** The key. Write-only: never returned. */
  apiKey: z.string().trim().min(ORG_AI_KEY_MIN).max(ORG_AI_KEY_MAX),
});

/**
 * The `PUT` body.
 *
 * @stability experimental
 */
export type SetOrgAiKeyInput = z.output<typeof setOrgAiKeySchema>;

/**
 * One provider's organization key, masked: whether one is stored, its last
 * four characters and when it was verified (stored).
 *
 * @stability experimental
 */
export const orgAiKeyViewSchema = z.object({
  /** Provider id. */
  provider: z.string(),
  /** The name the UI shows. */
  displayName: z.string(),
  /** Whether the organization stores a key for the provider. */
  configured: z.boolean(),
  /** The key's last four characters, or `null`. */
  hint: z.string().nullable(),
  /** When the provider last accepted the key. */
  verifiedAt: z.iso.datetime().nullable(),
});

/**
 * One provider's organization key on the wire.
 *
 * @stability experimental
 */
export type OrgAiKeyView = z.infer<typeof orgAiKeyViewSchema>;


/**
 * Compile-time proof that the org-key view carries no key material: adding
 * one of those fields makes this `never` and the file stops compiling.
 *
 * @stability experimental
 */
export type OrgAiKeyViewCarriesNoSecret =
  Extract<keyof OrgAiKeyView, KeyMaterialFieldNames> extends never ? true : never;

/**
 * The proof, as a value.
 *
 * @stability experimental
 */
export const ORG_AI_KEY_VIEW_CARRIES_NO_SECRET: OrgAiKeyViewCarriesNoSecret = true;
