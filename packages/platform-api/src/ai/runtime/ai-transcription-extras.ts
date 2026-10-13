// =============================================================================
// Transcription extras: the bounded, validated tail of a transcript
// (PP-14.17, issue #935)
// =============================================================================
//
// `AiTranscriptionResult.extras` is where a provider reports what the neutral
// result has no field for: speaker-labelled segments (diarization), a language,
// anything else JSON. It crosses a trust boundary on the way out of an adapter
// (a third party's adapter, with a vendor's response behind it) and ends up in
// `ai_runs.output` and in the HTTP run view, so it is checked here, once:
//
//   - JSON-serialisable (a cycle, a function or a bigint is refused);
//   - at most `AI_TRANSCRIPTION_EXTRAS_MAX_BYTES` serialised;
//   - `segments`, when present, at most `AI_TRANSCRIPTION_EXTRAS_MAX_SEGMENTS`
//     entries of `{ start, end, text, speaker? }` with finite numbers;
//   - `language`, when present, a short string.
//
// A result that fails any of it KEEPS ITS TRANSCRIPT and loses only the
// extras: the provider call already happened and was billed, so refusing the
// whole result would throw away what the user paid for. Nothing about the
// rejected value is logged (it is the user's transcript); the caller logs the
// reason, a short constant.
// =============================================================================

import { z } from 'zod';

import {
  AI_TRANSCRIPTION_EXTRAS_MAX_BYTES,
  AI_TRANSCRIPTION_EXTRAS_MAX_SEGMENTS,
  type AiTranscriptionExtras,
} from '../core/types/media.types';

/** The shape a transcript's extras must have. Extra keys pass through. */
export const aiTranscriptionExtrasSchema = z.looseObject({
  segments: z
    .array(
      z.object({
        start: z.number().finite(),
        end: z.number().finite(),
        text: z.string(),
        speaker: z.string().max(128).optional(),
      }),
    )
    .max(AI_TRANSCRIPTION_EXTRAS_MAX_SEGMENTS)
    .optional(),
  language: z.string().max(64).optional(),
});

/** Why extras were dropped (a constant, safe to log). */
export type AiTranscriptionExtrasRejection = 'not_json' | 'too_large' | 'malformed';

/**
 * The extras to keep, or why they cannot be kept.
 *
 * @param extras - whatever the adapter returned in `AiTranscriptionResult.extras`.
 * @returns `{ extras }` (a plain JSON copy) or `{ rejected }`; `{}` for none.
 */
export function boundTranscriptionExtras(
  extras: unknown,
): { extras?: AiTranscriptionExtras; rejected?: AiTranscriptionExtrasRejection } {
  if (extras === undefined || extras === null) return {};

  let serialised: string | undefined;

  try {
    serialised = JSON.stringify(extras);
  } catch {
    return { rejected: 'not_json' };
  }

  if (serialised === undefined || typeof extras !== 'object' || Array.isArray(extras)) return { rejected: 'not_json' };
  if (Buffer.byteLength(serialised, 'utf8') > AI_TRANSCRIPTION_EXTRAS_MAX_BYTES) return { rejected: 'too_large' };

  // Parse the serialised copy: what is kept is plain JSON, never the adapter's live object.
  const parsed = aiTranscriptionExtrasSchema.safeParse(JSON.parse(serialised));

  return parsed.success ? { extras: parsed.data as AiTranscriptionExtras } : { rejected: 'malformed' };
}
