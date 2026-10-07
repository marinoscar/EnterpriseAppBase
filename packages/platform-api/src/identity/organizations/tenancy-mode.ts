// =============================================================================
// TENANCY_MODE — how this deployment isolates its users (PP-6.2, #722)
// =============================================================================
//
// The platform-packages spec (docs/specs/platform-packages.md, "Tenancy mode
// is a deployment setting") runs two tenancy modes on the same code and the
// same tables:
//
//   single   Everyone is in one organization (the default one), org
//            management is hidden and users auto-join it. EvoPath, kvox and
//            MemoriaHub today; an on-prem single customer.
//   multi    One organization per customer (B2B SaaS). A new user joins
//            nothing by itself, and a user with no active membership is
//            refused at sign-in (`no_organization`).
//
// A DEPLOYMENT-LEVEL FACT, AND THEREFORE AN ENVIRONMENT VARIABLE, like
// `DEPLOYMENT_MODE` (./deployment-mode.ts, read its header). Switching tenancy
// at runtime would change who can see what in the middle of a session, so an
// administrator must not be able to flip it from the UI. It is read once, at
// startup. Unlike storage, AI, SMTP or VAPID, it is therefore legitimately an
// env var.
//
// ⚠ AN INVALID VALUE FAILS STARTUP. Guessing `single` on a multi-org
// deployment would auto-join every new sign-in to the default organization;
// guessing `multi` on a single-org one would lock new users out. Only unset
// (or empty) has a default, `single`, which is what every deployment that
// predates this variable is.
//
// This module is PURE: no Nest, no `process.env`. The parse is the single
// source of truth; `configuration.ts` (the config factory), `main.ts` (the
// bootstrap log line) and `TenancyService` all call it, so they cannot
// disagree. The `TenancyMode` type is ADR 0001's, from
// `@marinoscar/platform-api/core`; it is never redefined here.
// =============================================================================

import type { TenancyMode } from '../../core/index';
import { z } from 'zod';

export type { TenancyMode };

/** The environment variable this module parses. */
export const TENANCY_MODE_ENV_VAR = 'TENANCY_MODE';

/** Every tenancy mode, in the order they are documented. */
export const TENANCY_MODES = ['single', 'multi'] as const satisfies readonly TenancyMode[];

// Compile-time guard: the list above covers every `TenancyMode` ADR 0001 names.
// A third mode added to the contract fails this line until it is listed here.
type MissingTenancyMode = Exclude<TenancyMode, (typeof TENANCY_MODES)[number]>;
const tenancyModesAreComplete: [MissingTenancyMode] extends [never] ? true : never = true;
void tenancyModesAreComplete;

/** What an unset or empty `TENANCY_MODE` means. */
export const DEFAULT_TENANCY_MODE: TenancyMode = 'single';

const tenancyModeSchema = z.enum(TENANCY_MODES);

/**
 * Parses `TENANCY_MODE`.
 *
 * - `undefined`, `''` or whitespace only → `'single'`.
 * - Surrounding whitespace is trimmed (an env file's trailing space is not a
 *   decision anybody made).
 * - ⚠ CASE-SENSITIVE, matching the CLI deploy wizard's validator: `Multi` is
 *   refused rather than folded.
 * - Anything else throws, with a message naming the variable and the allowed
 *   values, so the deploy log says exactly what to fix.
 *
 * @throws {Error} on any value that is not a tenancy mode.
 */
export function parseTenancyMode(raw: string | undefined): TenancyMode {
  const value = (raw ?? '').trim();

  if (value === '') return DEFAULT_TENANCY_MODE;

  const parsed = tenancyModeSchema.safeParse(value);
  if (parsed.success) return parsed.data;

  throw new Error(
    `${TENANCY_MODE_ENV_VAR}=${JSON.stringify(raw)} is not a valid tenancy mode. ` +
      `Allowed values: ${TENANCY_MODES.join(', ')} (unset means ${DEFAULT_TENANCY_MODE}). ` +
      'The API refuses to start rather than guess, because either guess changes who is ' +
      'joined to which organization at sign-in. Fix the value in the deployment environment ' +
      '(infra/compose/.env) and restart.'
  );
}

/**
 * What a tenancy mode does at sign-in. One table, so the auth path asks a
 * capability rather than repeating `mode === 'single'` checks.
 */
export interface TenancyCapabilities {
  /**
   * Every signing-in user is ensured a membership in the default organization:
   * at creation (in the user's own transaction) and, self-healing, at every
   * later sign-in. `true` in `single` only.
   */
  autoJoinDefaultOrg: boolean;
  /**
   * A user with no active membership is refused at sign-in with
   * `no_organization`. `true` in `multi` only (in `single` the auto-join above
   * makes it moot).
   */
  requireActiveMembership: boolean;
}

/** Pure. The capability table, by mode. */
export function tenancyCapabilitiesFor(mode: TenancyMode): TenancyCapabilities {
  switch (mode) {
    case 'single':
      return { autoJoinDefaultOrg: true, requireActiveMembership: false };
    case 'multi':
      return { autoJoinDefaultOrg: false, requireActiveMembership: true };
  }
}

/** One line for the startup log. */
export function describeTenancyMode(mode: TenancyMode): string {
  return mode === 'single'
    ? `Tenancy mode: single (${TENANCY_MODE_ENV_VAR}). Every user joins the default organization.`
    : `Tenancy mode: multi (${TENANCY_MODE_ENV_VAR}). Users join organizations by invitation; ` +
        'a user with no active membership is refused at sign-in.';
}

/**
 * The bootstrap check: parse the variable, log the mode once, return it.
 * Called from `main.ts` beside `verifyDeploymentModeAtStartup`, before the Nest
 * application exists, so a typo never opens a database connection.
 */
export function verifyTenancyModeAtStartup(
  env: Record<string, string | undefined>,
  logger: { log(message: string): void }
): TenancyMode {
  const mode = parseTenancyMode(env[TENANCY_MODE_ENV_VAR]);

  logger.log(describeTenancyMode(mode));

  return mode;
}
