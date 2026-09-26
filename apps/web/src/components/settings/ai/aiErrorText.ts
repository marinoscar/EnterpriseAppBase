/**
 * Turning AI error codes into sentences a user can act on — issue #430.
 *
 * The AI API answers with a GENERIC top-level `code` (`BAD_REQUEST`,
 * `FORBIDDEN`, …) and puts the AI-specific code in `details.reason`, so
 * `aiErrorReason` reads `details.reason` first and only falls back to `code`.
 * Switching on `ApiError.code` alone would never see `AI_KEY_INVALID`.
 */
import { ApiError } from '../../../services/api';

const FRIENDLY: Record<string, string> = {
  AI_KEY_INVALID: 'The provider rejected this key',
  AI_KEY_REQUIRED: 'A key is required for this provider',
  AI_DISABLED: 'AI has been switched off by your administrator',
  AI_PROVIDER_DISABLED: 'Your administrator has disabled this provider',
  AI_PROVIDER_UNAVAILABLE: 'The provider could not be reached. Try again later',
  AI_RATE_LIMITED: 'The provider is rate limiting requests. Try again shortly',
};

/** The AI-specific reason carried by an API error, if any. */
export function aiErrorReason(err: unknown): string | null {
  if (!(err instanceof ApiError)) return null;
  const details = err.details;
  if (details && typeof details === 'object' && 'reason' in details) {
    const reason = (details as { reason?: unknown }).reason;
    if (typeof reason === 'string') return reason;
  }
  return err.code ?? null;
}

/** A friendly sentence for an AI error code; unknown codes get a generic one. */
export function aiCodeText(code: string | null | undefined): string {
  if (!code) return 'Something went wrong';
  return FRIENDLY[code] ?? `The provider reported an error (${code})`;
}

/** A friendly sentence for a thrown error from an AI call. */
export function aiErrorText(err: unknown, fallback: string): string {
  const reason = aiErrorReason(err);
  if (reason && FRIENDLY[reason]) return FRIENDLY[reason];
  if (err instanceof Error && err.message) return err.message;
  return fallback;
}
