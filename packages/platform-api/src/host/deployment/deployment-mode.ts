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
// OPEN VOCABULARIES (PP-14.13). The two modes above are the platform's
// `BUILTIN_DEPLOYMENT_MODES`; an app adds its own with `registerDeploymentMode`
// (a BYOC mode, an on-prem mode) and its own switches with
// `registerDeploymentCapability`, both AT IMPORT TIME, before `main.ts` parses
// the variable. The platform's `saas` mode and `inAppRestore` capability
// register through the same two functions. What a mode permits is resolved in
// one place, `capabilitiesFor`: the mode's own entry, else the capability's
// `byMode` entry, else its `default`.
//
// This module is PURE: no Nest, no `process.env`. The parse is the single
// source of truth; `main.ts` calls it at bootstrap and `DeploymentModeService`
// calls it again when the container builds, so neither can disagree with it.
// =============================================================================

import { defineRegistry, type Registry } from '../../core/index';

/** The environment variable this module parses.
 *
 * @stability experimental
 */
export const DEPLOYMENT_MODE_ENV_VAR = 'DEPLOYMENT_MODE';

/** The platform's own deployment modes, in the order they are documented.
 *
 * @stability experimental
 */
export const BUILTIN_DEPLOYMENT_MODES = ['self-hosted', 'saas'] as const;

/**
 * The deprecated name of {@link BUILTIN_DEPLOYMENT_MODES}. It lists only the
 * platform's modes, not the ones an app registered; read
 * `deploymentModeRegistry.ids()` for those.
 *
 * @deprecated Use {@link BUILTIN_DEPLOYMENT_MODES}.
 * @stability experimental
 */
export const DEPLOYMENT_MODES = BUILTIN_DEPLOYMENT_MODES;

/**
 * One of the platform's own deployment modes: `self-hosted` or `saas`.
 *
 * @stability experimental
 */
export type BuiltinDeploymentMode = (typeof BUILTIN_DEPLOYMENT_MODES)[number];

/**
 * A deployment mode: a built-in one, or the id of a mode the app registered
 * with {@link registerDeploymentMode}.
 *
 * @stability experimental
 */
export type DeploymentMode = BuiltinDeploymentMode | (string & {});

/**
 * The id pattern of a deployment mode: lower-case, 2 to 32 characters,
 * starting with a letter (`self-hosted`, `saas`, `byoc`).
 *
 * @stability experimental
 */
export const DEPLOYMENT_MODE_ID_PATTERN = /^[a-z][a-z0-9-]{1,31}$/;

/**
 * The id pattern of a deployment capability: camel case, starting with a
 * lower-case letter (`inAppRestore`, `multiRegion`).
 *
 * @stability experimental
 */
export const DEPLOYMENT_CAPABILITY_ID_PATTERN = /^[a-z][A-Za-z0-9]{1,47}$/;

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

  if (deploymentModeRegistry.has(value)) {
    return value;
  }

  throw new Error(
    `${DEPLOYMENT_MODE_ENV_VAR}=${JSON.stringify(raw)} is not a valid deployment mode. ` +
      `Allowed values: ${deploymentModeRegistry.ids().join(', ')} (unset means ${DEFAULT_DEPLOYMENT_MODE}). ` +
      'The API refuses to start rather than guess, because either guess changes whether ' +
      'in-app database restore is available. Fix the value in the deployment environment ' +
      '(infra/compose/.env) and restart. A mode the app defines is registered with ' +
      'registerDeploymentMode() at import time, before the API starts.'
  );
}

/**
 * What a deployment mode permits: one boolean per registered capability.
 * `inAppRestore` is the platform's own; an app adds more with
 * {@link registerDeploymentCapability} (declare the field on this interface by
 * declaration merging to type it; an unlisted capability reads as `boolean`
 * through the index signature).
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
  /** Any capability an app registered with {@link registerDeploymentCapability}. */
  [capabilityId: string]: boolean;
}

/**
 * One deployment capability: a yes/no fact about what a mode permits.
 *
 * @stability experimental
 */
export interface DeploymentCapabilityDef {
  /** The id. See {@link DEPLOYMENT_CAPABILITY_ID_PATTERN}. */
  readonly id: string;
  /** The value in a mode that says nothing about it. */
  readonly default: boolean;
  /** The value in particular modes, by mode id. A mode's own entry (see {@link DeploymentModeDef}) wins. */
  readonly byMode?: Readonly<Record<string, boolean>>;
}

/**
 * One deployment mode.
 *
 * @stability experimental
 */
export interface DeploymentModeDef {
  /** The id operators select it by (`DEPLOYMENT_MODE=byoc`). See {@link DEPLOYMENT_MODE_ID_PATTERN}. */
  readonly id: string;
  /**
   * The capabilities this mode sets, by capability id; any other capability
   * takes its `byMode` entry or its `default`. Every id must be registered by
   * the time the mode is used.
   */
  readonly capabilities: Readonly<Record<string, boolean>>;
}

function assertBooleanRecord(owner: string, what: string, value: unknown): void {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${owner}: ${what} must be an object of booleans`);
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== 'boolean') throw new Error(`${owner}: ${what}.${key} must be a boolean`);
  }
}

/**
 * Every registered deployment capability, in registration order (the built-in
 * `inAppRestore` first). Frozen when the application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const deploymentCapabilityRegistry: Registry<DeploymentCapabilityDef> = defineRegistry<DeploymentCapabilityDef>({
  name: 'host.deployment-capabilities',
  idOf: (capability) => capability.id,
  idPattern: DEPLOYMENT_CAPABILITY_ID_PATTERN,
  validate: (capability) => {
    const owner = `deployment capability "${capability.id}"`;
    if (typeof capability.default !== 'boolean') throw new Error(`${owner}: default must be a boolean`);
    if (capability.byMode !== undefined) assertBooleanRecord(owner, 'byMode', capability.byMode);
  },
});

/**
 * Every registered deployment mode, in registration order (`self-hosted`, then
 * `saas`). Frozen when the application has bootstrapped.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const deploymentModeRegistry: Registry<DeploymentModeDef> = defineRegistry<DeploymentModeDef>({
  name: 'host.deployment-modes',
  idOf: (mode) => mode.id,
  idPattern: DEPLOYMENT_MODE_ID_PATTERN,
  validate: (mode) => {
    assertBooleanRecord(`deployment mode "${mode.id}"`, 'capabilities', mode.capabilities);
  },
});

/**
 * Registers a deployment capability. Call it at module load, before the
 * application is created; a duplicate id throws.
 *
 * @param capability - the capability.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * // apps/api/src/app-registrations/host.ts
 * registerDeploymentCapability({ id: 'bulkExport', default: true, byMode: { saas: false } });
 * // then: app.get(DeploymentModeService).can('bulkExport')
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerDeploymentCapability(capability: DeploymentCapabilityDef): void {
  deploymentCapabilityRegistry.register(capability);
}

/**
 * Registers a deployment mode, selectable with `DEPLOYMENT_MODE=<id>`. Call it
 * at module load, before `main.ts` parses the variable; a duplicate id throws.
 *
 * @param mode - the mode.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * // apps/api/src/app-registrations/host.ts
 * registerDeploymentMode({ id: 'byoc', capabilities: { inAppRestore: false } });
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerDeploymentMode(mode: DeploymentModeDef): void {
  deploymentModeRegistry.register(mode);
}

// The platform's own mode and capability, through the same functions an app uses.
registerDeploymentCapability({ id: 'inAppRestore', default: true, byMode: { saas: false } });
registerDeploymentMode({ id: 'self-hosted', capabilities: {} });
registerDeploymentMode({ id: 'saas', capabilities: {} });

/**
 * Pure. What `mode` permits: for each registered capability, the mode's own
 * entry, else the capability's `byMode` entry, else its `default`.
 *
 * @param mode - a registered deployment mode.
 * @returns one boolean per registered capability.
 * @throws Error when `mode` is not registered, or the mode sets a capability nobody registered.
 *
 * @stability experimental
 */
export function capabilitiesFor(mode: DeploymentMode): DeploymentCapabilities {
  const definition = deploymentModeRegistry.get(mode);
  if (!definition) {
    throw new Error(
      `Unknown deployment mode "${mode}". Registered modes: ${deploymentModeRegistry.ids().join(', ')}. ` +
        'Register one with registerDeploymentMode() at import time.'
    );
  }
  for (const id of Object.keys(definition.capabilities)) {
    if (!deploymentCapabilityRegistry.has(id)) {
      throw new Error(
        `Deployment mode "${mode}" sets the capability "${id}", which nobody registered. ` +
          `Registered capabilities: ${deploymentCapabilityRegistry.ids().join(', ')}. ` +
          'Register it with registerDeploymentCapability() at import time.'
      );
    }
  }

  const resolved: Record<string, boolean> = {};
  for (const capability of deploymentCapabilityRegistry.list()) {
    resolved[capability.id] = definition.capabilities[capability.id] ?? capability.byMode?.[mode] ?? capability.default;
  }
  return resolved as DeploymentCapabilities;
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
