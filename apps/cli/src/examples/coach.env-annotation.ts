import type { EnvKeyAnnotation } from '@marinoscar/platform-cli/core';

// =============================================================================
// EXAMPLE, NOT WIRED: an app's override of a platform env key (PP-14.22)
// =============================================================================
//
// Each env key has one owner, so an app could not change how the wizard treats
// a key the PLATFORM owns. `annotateEnvKey` (or `createCli({ envAnnotations })`)
// is the narrow exception, with an explicit rule: THE APP WINS, for `fixed` and
// `help` only. Everything else about the key (secret, never, validate,
// generate, group) stays the owner's, and `fixed` on a secret key is refused,
// so an annotation can never unmask a secret, bring back a key that is never
// written, or weaken a validator.
//
// To use the pattern in a fork:
//
//   envAnnotations: coachEnvAnnotations,
// =============================================================================

/** The coach stack names its API service, and explains the sender address in its own words. */
export const coachEnvAnnotations: Readonly<Record<string, EnvKeyAnnotation>> = {
  OTEL_SERVICE_NAME: { fixed: 'coach-api' },
  APP_URL: { help: 'The public address the coaching app is served from, for example https://coach.example.com.' },
};
