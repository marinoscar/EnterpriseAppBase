// =============================================================================
// DEPLOYMENT_MODE — what kind of deployment this process is part of (#685)
// =============================================================================
//
// The platform-packages spec (docs/specs/platform-packages.md, "Deployment
// modes") runs SaaS, BYOC and on-prem from one codebase. The first behaviour
// that differs between them is in-app database restore: a SaaS deployment sits
// on a managed database (RDS with point-in-time recovery), where recovery
// belongs to the provider and the application's role should hold neither
// `CREATEDB` nor rename rights. So `saas` turns in-app restore off; backups keep
// working in both modes.
//
// A DEPLOYMENT-LEVEL FACT, AND THEREFORE AN ENVIRONMENT VARIABLE. It is decided
// by whoever runs the infrastructure, like `JOBS_WORKER_MODE`, and it is not a
// runtime setting: an administrator (or a compromised admin account) must not
// be able to switch a SaaS deployment back to self-hosted from the UI and then
// run a database swap. It is read once, at startup.
//
// ⚠ AN INVALID VALUE FAILS STARTUP, unlike `JOBS_WORKER_MODE` (unknown → `all`
// with a warning). Silently picking a mode is unsafe in BOTH directions:
// `self-hosted` re-enables a destructive capability on a SaaS deployment, and
// `saas` silently removes recovery from an on-prem install. Only "unset" (or
// empty) has a default, `self-hosted`, which is what every deployment that
// predates this variable is.
//
// This module is PURE: no Nest, no `process.env`. The parse is the single
// source of truth; `main.ts` calls it at bootstrap and `DeploymentModeService`
// calls it again when the container builds, so neither can disagree with it.
// =============================================================================

/** The environment variable this module parses.
 *
 * @stability experimental
 */
export const DEPLOYMENT_MODE_ENV_VAR = 'DEPLOYMENT_MODE';

/** Every deployment mode, in the order they are documented.
 *
 * @stability experimental
 */
export const DEPLOYMENT_MODES = ['self-hosted', 'saas'] as const;

/**
 * A deployment mode: `self-hosted` or `saas`.
 *
 * @stability experimental
 */
export type DeploymentMode = (typeof DEPLOYMENT_MODES)[number];

/** What an unset or empty `DEPLOYMENT_MODE` means.
 *
 * @stability experimental
 */
export const DEFAULT_DEPLOYMENT_MODE: DeploymentMode = 'self-hosted';

/**
 * Parses `DEPLOYMENT_MODE`.
 *
 * - `undefined`, `''` or whitespace only → `'self-hosted'`.
 * - Surrounding whitespace is trimmed (an env file's trailing space is not a
 *   decision anybody made).
 * - ⚠ CASE-SENSITIVE. `SaaS` is refused rather than folded, matching the CLI
 *   deploy wizard's validator: the value is documented in lower case, and a
 *   parser that accepted variants would make the template and the wizard
 *   disagree about what is valid.
 * - Anything else throws, with a message naming the variable and the allowed
 *   values, so the deploy log says exactly what to fix.
 *
 * @throws Error on any value that is not a deployment mode.
 *
 * @stability experimental
 */
export function parseDeploymentMode(raw: string | undefined): DeploymentMode {
  const value = (raw ?? '').trim();

  if (value === '') return DEFAULT_DEPLOYMENT_MODE;

  if ((DEPLOYMENT_MODES as readonly string[]).includes(value)) {
    return value as DeploymentMode;
  }

  throw new Error(
    `${DEPLOYMENT_MODE_ENV_VAR}=${JSON.stringify(raw)} is not a valid deployment mode. ` +
      `Allowed values: ${DEPLOYMENT_MODES.join(', ')} (unset means ${DEFAULT_DEPLOYMENT_MODE}). ` +
      'The API refuses to start rather than guess, because either guess changes whether ' +
      'in-app database restore is available. Fix the value in the deployment environment ' +
      '(infra/compose/.env) and restart.'
  );
}

/**
 * What a deployment mode permits. One predicate today; later deployment-mode
 * behaviour adds a field here rather than a second `mode === 'saas'` check
 * somewhere else.
 *
 * @stability experimental
 */
export interface DeploymentCapabilities {
  /**
   * Whether the application may restore its own database (the `db.restore.run`
   * job, the restore and rollback routes). `false` in `saas`: recovery is the
   * managed database provider's point-in-time recovery.
   */
  inAppRestore: boolean;
}

/** Pure. The capability table, by mode.
 *
 * @stability experimental
 */
export function capabilitiesFor(mode: DeploymentMode): DeploymentCapabilities {
  switch (mode) {
    case 'saas':
      return { inAppRestore: false };
    case 'self-hosted':
      return { inAppRestore: true };
  }
}

/** One line for the startup log.
 *
 * @stability experimental
 */
export function describeDeploymentMode(mode: DeploymentMode): string {
  const capabilities = capabilitiesFor(mode);

  return (
    `Deployment mode: ${mode} (${DEPLOYMENT_MODE_ENV_VAR}). In-app database restore is ` +
    (capabilities.inAppRestore
      ? 'available; in-app backups are available.'
      : "DISABLED (use the database provider's point-in-time recovery); in-app backups are available.")
  );
}

/**
 * The bootstrap check: parse the variable, log the mode once, return it.
 *
 * Called from `main.ts` BEFORE the Nest application is created, next to the
 * `CORS_ORIGIN` parse, because it needs nothing but the environment: a
 * deployment with a typo never opens a database connection and never binds the
 * port. Throws (rather than exiting) for the same reason the other bootstrap
 * checks do — `bootstrap()` is called unhandled, so the rejection exits Node
 * non-zero with the message on stderr.
 *
 * @stability experimental
 */
export function verifyDeploymentModeAtStartup(
  env: Record<string, string | undefined>,
  logger: { log(message: string): void }
): DeploymentMode {
  const mode = parseDeploymentMode(env[DEPLOYMENT_MODE_ENV_VAR]);

  logger.log(describeDeploymentMode(mode));

  return mode;
}
