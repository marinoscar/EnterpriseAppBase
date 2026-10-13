import { randomBytes } from 'node:crypto';

import type { EnvGeneratorRegistration } from '@marinoscar/platform-cli/core';

// =============================================================================
// EXAMPLE, NOT WIRED: an app's own kind of generated env value (PP-14.22)
// =============================================================================
//
// `base64-32` and `hex-32` were the only ways a value could be generated. A
// generator is a registered kind: a SYNCHRONOUS FUNCTION that returns a string.
// It is not a command, so there is no `openssl rand ...` to register and the
// platform spawns nothing on its behalf. What it returns is checked before it
// is written to `.env` (letters, digits and + / = _ . : @ - only, 1 to 512
// characters), so a generator cannot smuggle a newline, a quote or `$(...)`
// into the file Compose reads.
//
// Use `node:crypto`, never `Math.random`. To use the pattern in a fork:
//
//   envGenerators: [coachTokenGenerator],
// =============================================================================

/** 24 URL-safe characters from 18 random bytes: a token short enough for a header, long enough to guess never. */
export const coachTokenGenerator: EnvGeneratorRegistration = {
  kind: 'token-24',
  generate: () => randomBytes(18).toString('base64url'),
};
