// The wire shapes of `/api/admin/ai/org-keys` (issue #739): an organization's
// own AI provider keys. Write-only: no response shape has a field able to
// carry a key, only whether one is stored and its last characters.

import { z } from 'zod';

/** Shortest key the org-key route accepts (the deployment-key route's bound). */
export const ORG_AI_KEY_MIN = 8;
/** Longest key the org-key route accepts. */
export const ORG_AI_KEY_MAX = 512;

/**
 * `PUT /api/admin/ai/org-keys/:provider`. The key is verified with the
 * provider first and stored only when it passes; it is never returned.
 *
 * @stability experimental
 */
export const setOrgAiKeySchema = z.object({
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
  provider: z.string(),
  displayName: z.string(),
  configured: z.boolean(),
  hint: z.string().nullable(),
  verifiedAt: z.iso.datetime().nullable(),
});

/**
 * One provider's organization key on the wire.
 *
 * @stability experimental
 */
export type OrgAiKeyView = z.infer<typeof orgAiKeyViewSchema>;

/** Field names no org-key response may carry, ever. */
type KeyMaterialFieldNames = 'apiKey' | 'key' | 'secret' | 'token' | 'ciphertext';

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
