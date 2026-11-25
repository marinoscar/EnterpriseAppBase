// =============================================================================
// Wire vocabulary shared with @marinoscar/platform-contract/ai (issue #991)
// =============================================================================
//
// The adapters need three values the platform's contract package also
// publishes. Importing the contract would make it a dependency of a package
// meant to run with nothing but zod and an SDK, so the values are COPIED
// here, unchanged. `@marinoscar/platform-api` depends on both packages and
// pins the copies to the originals in
// `packages/platform-api/src/ai/core/ai-providers-integration.spec.ts`: a change to
// either side without the other fails that spec.
// =============================================================================

/**
 * The shape of a capability id (`AI_CAPABILITY_ID_PATTERN` in
 * `@marinoscar/platform-contract/ai`): lowercase, starting with a letter,
 * 2 to 48 characters.
 *
 * @stability experimental
 */
export const AI_CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9_]{1,47}$/;

/**
 * The wire APIs an OpenAI-family server can be spoken to with
 * (`AI_OPENAI_API_STYLES` in `@marinoscar/platform-contract/ai`).
 *
 * @stability experimental
 */
export const AI_OPENAI_API_STYLES = ['responses', 'chat_completions'] as const;

/**
 * One of {@link AI_OPENAI_API_STYLES}.
 *
 * @stability experimental
 */
export type AiOpenAiApiStyle = (typeof AI_OPENAI_API_STYLES)[number];

/**
 * An Azure `api-version` query value (`AI_AZURE_API_VERSION_PATTERN` in
 * `@marinoscar/platform-contract/ai`).
 *
 * @stability experimental
 */
export const AI_AZURE_API_VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
