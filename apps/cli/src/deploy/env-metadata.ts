import {
  generateBase64Key,
  generateHexKey,
  generateValue,
  isPlaceholderValue,
  needsAutoGenerate,
  resolveEnvMetadata,
  validateBase64Key32,
  validateEmail,
  validatePort,
  type EnvVarMetadata as PlatformEnvVarMetadata,
} from '@marinoscar/platform-cli/core';

import { ensurePlatformRegistrations } from '../platform-host/register.js';

// =============================================================================
// The handful of keys that need more than their template default
// =============================================================================
// (issue #174, epic #168)
//
// env-spec.ts gets the QUESTION out of .env.example. This gets the GOOD
// question, for the minority of keys where the difference matters: mask it,
// generate it, validate it, compute it, or never ask at all.
//
// THIS REGISTRY IS DELIBERATELY SMALL AND DELIBERATELY NOT EXHAUSTIVE. A key
// with no entry still works - not secret, not essential, template default,
// help text from the parsed comments. That fallback IS the template-safety
// property: a fork that adds SENTRY_DSN gets a usable prompt without touching
// this file. Adding an entry per variable would quietly undo that, because the
// next fork's variables would be the ones without entries.
//
// NOT THE ONLY SOURCE ANY MORE (PP-4.5, #706). Slices contribute their own
// entries as env-spec FRAGMENTS (`registerEnvSpecFragment` in
// `@marinoscar/platform-cli/core`): the telemetry keys (PostgreSQL monitor
// login, OTEL_*, GREPTIME_*) are `telemetryEnvSpecFragment` now. `metadataFor`
// consults this map first, then the fragments. A key has exactly one owner:
// this map is registered as a fragment too (`platform-host/register.ts`), so a
// key defined here AND in a fragment throws at registration, naming both.
// The metadata types and the pure helpers below live in the package as well
// and are re-exported here, so no import site changes.
// =============================================================================

export type { DeriveContext, GenerateKind } from '@marinoscar/platform-cli/core';
export {
  generateBase64Key,
  generateHexKey,
  generateValue,
  isPlaceholderValue,
  needsAutoGenerate,
  validateBase64Key32,
  validateEmail,
  validatePort,
};

/**
 * Feature groups. Their keys are skipped unless the group is enabled.
 * `observability` is ALWAYS enabled on a VPS (#567): see `effectiveGroups` in
 * compose-files.ts. The others are opt-in.
 *
 * A runtime list as well as a type, because a fragment from a package declares
 * its group as a plain string: `metadataFor` refuses one naming a group this
 * CLI does not know rather than silently never asking its keys.
 */
export const ENV_GROUPS = ['observability', 'email', 'microsoft-oauth'] as const;
export type EnvGroup = (typeof ENV_GROUPS)[number];

/**
 * The platform's `EnvVarMetadata` (see `@marinoscar/platform-cli/core` for
 * every field), with `group` narrowed to this CLI's feature groups.
 *
 * `allowBlank` on the VPS path is set ONLY where blank has a defined meaning
 * of its own: the PostgreSQL monitor login (#598), whose blank falls back to
 * the API's login. The LOCAL profile in `init/` (issue #344) sets it for
 * `GOOGLE_CLIENT_ID`, which may legitimately be filled in later. A deployment
 * that cannot reach its own OAuth provider is still not a deployment, so the
 * OAuth keys never carry it there. `deploy update` never counts an
 * `allowBlank` key as needing an answer.
 */
export interface EnvVarMetadata extends Omit<PlatformEnvVarMetadata, 'group'> {
  /** Only asked when the operator opted into this group. */
  group?: EnvGroup;
}

function requireMinLength(minimum: number) {
  return (value: string): string | undefined =>
    value.length >= minimum
      ? undefined
      : `must be at least ${minimum} characters (got ${value.length})`;
}

/** Rejects a value that is present but still the template's placeholder. */
function rejectPlaceholder(value: string): string | undefined {
  return /^your-|^change-me|example\.com$/i.test(value)
    ? 'still looks like the placeholder from .env.example'
    : undefined;
}

function combine(
  ...validators: ReadonlyArray<(value: string) => string | undefined>
) {
  return (value: string): string | undefined => {
    for (const validate of validators) {
      const message = validate(value);
      if (message !== undefined) return message;
    }
    return undefined;
  };
}

/**
 * A validator accepting exactly one of `values` (case-sensitive, as the API
 * compares after its own normalisation; the wizard writes the canonical form).
 */
export function oneOf(...values: readonly string[]) {
  return (value: string): string | undefined =>
    values.includes(value) ? undefined : `must be one of: ${values.join(', ')}`;
}

/**
 * A whole number that may be zero (e.g. a TTL where `0` means "off"). Digits
 * only, so `1.5`, `-1` and `30s` are refused before they reach the API, which
 * would otherwise fall back to its default with a warning.
 */
export function validateNonNegativeInteger(value: string): string | undefined {
  return /^\d+$/.test(value.trim()) && Number.isSafeInteger(Number(value.trim()))
    ? undefined
    : 'must be a whole number of seconds (0 or more)';
}

export const ENV_METADATA: Readonly<Record<string, EnvVarMetadata>> = {
  // --- Application ---------------------------------------------------------
  NODE_ENV: { fixed: 'production' },
  APP_URL: {
    // Derived, not asked. APP_URL and GOOGLE_CALLBACK_URL disagreeing with the
    // certificate's domain is the single most common failure in a hand-built
    // .env, and both restate information the operator has already given.
    derive: ({ domain }) => `https://${domain}`,
  },

  // --- Database ------------------------------------------------------------
  // Asked explicitly rather than defaulted: .env.example says `localhost`
  // while base.compose.yml falls back to `db`, and which of the two is right
  // depends on where the process runs, not on the deployment. `db` is a compose
  // service name that only resolves INSIDE the stack (devdb.compose.yml defines
  // it); `localhost` only works from the host. Inheriting either blindly would
  // be wrong for the other case.
  POSTGRES_HOST: { essential: true },
  POSTGRES_PORT: { validate: validatePort },
  POSTGRES_USER: { essential: true },
  POSTGRES_PASSWORD: { essential: true, secret: true },
  POSTGRES_DB: { essential: true },
  // POSTGRES_MONITOR_USER / _PASSWORD (#598): `telemetryEnvSpecFragment`.

  // --- JWT / session -------------------------------------------------------
  JWT_SECRET: {
    essential: true,
    secret: true,
    generate: 'base64-32',
    validate: combine(requireMinLength(32), rejectPlaceholder),
  },
  COOKIE_SECRET: {
    essential: true,
    secret: true,
    generate: 'base64-32',
    validate: combine(requireMinLength(32), rejectPlaceholder),
  },

  // --- Credential encryption ----------------------------------------------
  // Offered for generation rather than merely accepted: object storage's secret
  // access key is encrypted with it (issue #377), so a deployment without one
  // cannot save a storage credential and every upload is refused with a 503.
  // Still not `essential` — an unattended install must be able to produce a
  // .env, and the API boots without it.
  SECRETS_ENCRYPTION_KEY: {
    secret: true,
    generate: 'base64-32',
    validate: validateBase64Key32,
  },

  // --- OAuth ---------------------------------------------------------------
  // An empty GOOGLE_CLIENT_ID crashes bootstrap outright with "OAuth2Strategy
  // requires a clientID option", so this is a hard requirement.
  GOOGLE_CLIENT_ID: { essential: true, validate: rejectPlaceholder },
  GOOGLE_CLIENT_SECRET: {
    essential: true,
    secret: true,
    validate: rejectPlaceholder,
  },
  GOOGLE_CALLBACK_URL: {
    derive: ({ domain }) => `https://${domain}/api/auth/google/callback`,
  },
  MICROSOFT_CLIENT_ID: { group: 'microsoft-oauth' },
  MICROSOFT_CLIENT_SECRET: { group: 'microsoft-oauth', secret: true },
  MICROSOFT_CALLBACK_URL: {
    group: 'microsoft-oauth',
    derive: ({ domain }) => `https://${domain}/api/auth/microsoft/callback`,
  },

  // --- Admin bootstrap -----------------------------------------------------
  // Without it nobody can become an admin: the seed writes the allowlist row,
  // and the first OAuth login matching this address claims the role.
  INITIAL_ADMIN_EMAIL: {
    essential: true,
    validate: combine(validateEmail, rejectPlaceholder),
  },

  // --- Deployment mode (#685) ----------------------------------------------
  // Not asked (the template's `self-hosted` is right for every VPS install
  // this wizard performs), but validated: the API refuses to start on any
  // other value, so a hand-edited typo is caught here first. Same list as
  // DEPLOYMENT_MODES in apps/api/src/common/deployment/deployment-mode.ts.
  DEPLOYMENT_MODE: { validate: oneOf('self-hosted', 'saas') },

  // --- Test authentication -------------------------------------------------
  // NEVER offered and never written. Setting it true in production fails
  // startup by design, and there is no reason a deployment should carry it.
  TEST_AUTH_ENABLED: { never: true },

  // --- Observability -------------------------------------------------------
  // OTEL_* and GREPTIME_* are `telemetryEnvSpecFragment`
  // (`@marinoscar/platform-cli/telemetry`), registered in
  // `platform-host/register.ts`.

  // --- Stack agent (#567) --------------------------------------------------
  // The API's credential for the stack-agent sidecar (vps.compose.yml), which
  // holds the Docker socket so the admin UI can redeploy the telemetry
  // containers. Only the stack reads it, so it is generated without a
  // question on install AND on update (the drift step's autoGenerate path),
  // and vps.compose.yml refuses to start without it. No group: the agent is
  // part of every VPS deployment. Hex, like the GreptimeDB passwords, so it
  // survives any quoting a hand-edited .env might put it through.
  STACK_AGENT_TOKEN: {
    secret: true,
    generate: 'hex-32',
    autoGenerate: true,
  },

  // --- Email (SES) ---------------------------------------------------------
  // THERE IS NO `storage` GROUP ANY MORE (issue #377, epic #372). Which bucket,
  // which region, which endpoint, which provider and which key are application
  // settings now, edited at /admin/settings/storage after the deployment is up,
  // so there is nothing about storage left to ask at install time — and asking
  // would recreate the second source of truth the epic removed.
  //
  // Only one survives (issue #585 removed the SES access key id/secret the
  // same way #377 removed storage's): SES_REGION still reads as a fallback
  // default, and only SES does.
  SES_REGION: { group: 'email' },

  // --- Cross-replica event bus (PP-1.11, #682) ------------------------------
  // Deployment topology: LISTEN/NOTIFY across replicas, or this process only.
  // The template ships `postgres`; the API itself falls back to `in-process`
  // on anything unrecognised, so the wizard refuses a typo before it is
  // written rather than leaving a deployment silently single-replica.
  EVENT_BUS_ADAPTER: { validate: oneOf('postgres', 'in-process') },

  // --- JWT principal cache (PP-1.12, #683) ----------------------------------
  // A performance knob with a safe default (30 s); `0` disables the cache.
  // Not asked: the template value is right for almost every deployment.
  AUTH_PRINCIPAL_CACHE_TTL_SECONDS: { validate: validateNonNegativeInteger },

  // --- Deployment network (PP-13.2, #773) -----------------------------------
  // Not asked (the template's `online` is right for every VPS install this
  // wizard performs), but validated: the API refuses to start on any other
  // value. Same list as DEPLOYMENT_NETWORKS in
  // apps/api/src/common/deployment/deployment-network.ts.
  DEPLOYMENT_NETWORK: { validate: oneOf('online', 'air-gapped') },

  // --- Tenancy mode (PP-6.2, #722) -------------------------------------------
  // Not asked and not essential (the template's `single` is right for every
  // current app), but validated: the API refuses to start on any other value.
  // An `update` of a deployment that predates the key adds it with that
  // default, without a question (it is neither essential nor secret). Same
  // list as TENANCY_MODES in apps/api/src/common/deployment/tenancy-mode.ts.
  TENANCY_MODE: { validate: oneOf('single', 'multi') },
};

function isEnvGroup(group: string): group is EnvGroup {
  return (ENV_GROUPS as readonly string[]).includes(group);
}

/** A fragment's entry, narrowed to this CLI's groups, or a loud refusal. */
function fromFragment(key: string): EnvVarMetadata | undefined {
  const metadata = resolveEnvMetadata(key);
  if (metadata === undefined) return undefined;
  if (metadata.group !== undefined && !isEnvGroup(metadata.group)) {
    throw new Error(
      `Env key "${key}" is in group "${metadata.group}", which this CLI does not know ` +
        `(known: ${ENV_GROUPS.join(', ')}). Add the group to ENV_GROUPS or change the fragment.`,
    );
  }
  return metadata as EnvVarMetadata;
}

/**
 * The annotation for `key`: this CLI's own entry, else the registered
 * fragment's, else `{}` (not secret, not essential, template default).
 */
export function metadataFor(key: string): EnvVarMetadata {
  ensurePlatformRegistrations();
  return ENV_METADATA[key] ?? fromFragment(key) ?? {};
}
