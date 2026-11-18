// =============================================================================
// OpenAI-compatible per-call settings (issue #448, epic #421)
// =============================================================================
//
// What `AiCallContext.providerSettings` carries for `openai-compatible` (the
// slot minus `enabled`/`baseUrl`), read with defaults. Never throws: a
// malformed field falls back to its default.
// =============================================================================

import { z } from 'zod';

import { AI_OPENAI_API_STYLES, type AiOpenAiApiStyle } from '../../core/index';
import type { OpenAiFamily } from '../openai-errors';

/**
 * The provider id of the OpenAI-compatible adapter.
 *
 * @stability experimental
 */
export const OPENAI_COMPATIBLE_PROVIDER_ID = 'openai-compatible';

/**
 * The OpenAI-family descriptor (id and label) of an OpenAI-compatible server.
 *
 * @stability experimental
 */
export const OPENAI_COMPATIBLE_FAMILY: OpenAiFamily = Object.freeze({
  providerId: OPENAI_COMPATIBLE_PROVIDER_ID,
  label: 'The OpenAI-compatible server',
});

/**
 * The wire API used when the slot names none: what every compatible server serves.
 *
 * @stability experimental
 */
export const OPENAI_COMPATIBLE_DEFAULT_API_STYLE: AiOpenAiApiStyle = 'chat_completions';

/**
 * The OpenAI-compatible per-call settings, each defaulted.
 *
 * @stability experimental
 */
export interface OpenAiCompatibleSettings {
  /** The wire API the server is spoken to with. */
  apiStyle: AiOpenAiApiStyle;
  /** False only when the administrator opted in to a keyless server. */
  requiresKey: boolean;
}

/**
 * Reads the call's OpenAI-compatible settings with defaults; never throws.
 *
 * @stability experimental
 */
export function openAiCompatibleSettings(raw: Readonly<Record<string, unknown>> | undefined): OpenAiCompatibleSettings {
  const apiStyle = z.enum(AI_OPENAI_API_STYLES).safeParse(raw?.apiStyle);

  return {
    apiStyle: apiStyle.success ? apiStyle.data : OPENAI_COMPATIBLE_DEFAULT_API_STYLE,
    requiresKey: raw?.requiresKey !== false,
  };
}
