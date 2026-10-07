// =============================================================================
// CLI identity by configuration  (PP-8.9, #715)
// =============================================================================
//
// The platform CLI is shared by every app, so it cannot carry a product name
// as a module constant the way `branding.ts` did (`CLI_NAME = 'appctl'`,
// rewritten per fork by `scripts/rename.mjs`). A package cannot be codemodded
// per app. Instead the app hands its identity to `createCli`, which calls
// `setCliIdentity` once, and every module reads it through the accessors
// below AT CALL TIME. Nothing may capture an identity value at module load:
// a constant computed on import would freeze whatever identity (or none) was
// set when the module happened to be imported first.
//
// Three facts are still DERIVED from the name, never configured separately
// unless an app must keep an old value (a migrated app's config directory):
//
//   1. the executable name shown in `--help` and in error messages;
//   2. the config directory, `~/.<name>/`;
//   3. the environment-variable prefix, `<NAME>_`.
//
// If those three were three settings, a rename would leave a binary called
// `acmectl` reading `~/.appctl/config.json` and answering to `APPCTL_TOKEN`,
// and nothing would fail.
//
// TWO STRINGS NEVER FOLLOW THE NAME. The deploy state file
// (`.appctl-deploy.json`, deploy/state.ts) and the proxy vhost sentinel
// (`# Managed by appctl deploy`, deploy/proxy.ts) are written AND parsed on
// live servers, so they are fixed literals that no identity changes. Deriving
// them would strand every server already deployed.
// =============================================================================

/**
 * The product identity an app gives the platform CLI.
 *
 * @stability experimental
 */
export interface CliIdentity {
  /**
   * The executable name, and the seed of the config directory and env prefix,
   * e.g. `appctl`. Lowercase ASCII letters, digits and hyphens, starting with
   * a letter: it becomes a dotfile directory and an env-var prefix.
   */
  name: string;
  /** Human name for banners and `--help`, e.g. `Acme CLI`. */
  displayName: string;
  /**
   * The product's own name, e.g. `Acme` (the systemd unit's Description).
   * Defaults to `displayName`.
   */
  productName?: string | undefined;
  /**
   * The per-user config directory name. Defaults to `.<name>`; override only
   * for a migrated app that must keep an old directory.
   */
  configDirName?: string | undefined;
  /** The env-var prefix. Defaults to `toEnvPrefix(name)`, e.g. `APPCTL_`. */
  envPrefix?: string | undefined;
  /** `owner/repo`, the app's source repository (help text, deploy defaults). */
  repoSlug: string;
}

/**
 * A {@link CliIdentity} with every default applied.
 *
 * @stability experimental
 */
export interface ResolvedCliIdentity {
  /** The executable name. */
  readonly name: string;
  /** Human name for banners and `--help`. */
  readonly displayName: string;
  /** The product's own name. */
  readonly productName: string;
  /** The per-user config directory name, e.g. `.appctl`. */
  readonly configDirName: string;
  /** Basename of the config file inside that directory: `config.json`. */
  readonly configFileName: string;
  /** The env-var prefix, e.g. `APPCTL_`. */
  readonly envPrefix: string;
  /** `owner/repo`. */
  readonly repoSlug: string;
}

/**
 * The API's global route prefix (`app.setGlobalPrefix('api')`). Not part of
 * the identity: moving it means moving the nginx routes too.
 *
 * @stability stable
 */
export const API_PATH_PREFIX = '/api';

/**
 * Basename of the config file. Deliberately not `credentials.json` or
 * `secrets.json`: a machine-level git excludesFile commonly blocks those, and
 * a fixture by that name would vanish from `git add` without a warning.
 */
const CONFIG_FILE_NAME = 'config.json';

const NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

/**
 * Turns a CLI name into a legal environment-variable prefix: `appctl` to
 * `APPCTL_`, `acme-cli` to `ACME_CLI_`. A hyphen is illegal in a shell
 * identifier (`export ACME-CLI_TOKEN=x` is a syntax error), and so is a
 * leading digit.
 *
 * @param name - A CLI name.
 * @returns The prefix, ending in `_`.
 * @stability experimental
 */
export function toEnvPrefix(name: string): string {
  const upper = name.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return /^[0-9]/.test(upper) ? `_${upper}_` : `${upper}_`;
}

/**
 * Applies the defaults to an identity and validates it.
 *
 * @param identity - The app's identity.
 * @returns The resolved, frozen identity.
 * @throws Error when the name is not lowercase `[a-z0-9-]` starting with a
 *   letter, or a required field is empty.
 * @stability experimental
 */
export function resolveCliIdentity(identity: CliIdentity): ResolvedCliIdentity {
  if (typeof identity?.name !== 'string' || !NAME_PATTERN.test(identity.name)) {
    throw new Error(
      `CLI identity name "${String(identity?.name)}" is invalid: use lowercase ASCII letters, digits and hyphens, starting with a letter (e.g. "appctl").`,
    );
  }
  if (typeof identity.displayName !== 'string' || identity.displayName.trim() === '') {
    throw new Error('CLI identity needs a non-empty displayName.');
  }
  if (typeof identity.repoSlug !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(identity.repoSlug)) {
    throw new Error(`CLI identity repoSlug "${String(identity.repoSlug)}" is not owner/repo.`);
  }
  const envPrefix = identity.envPrefix ?? toEnvPrefix(identity.name);
  if (!/^[A-Z_][A-Z0-9_]*_$/.test(envPrefix)) {
    throw new Error(`CLI identity envPrefix "${envPrefix}" is not a legal env-var prefix ending in "_".`);
  }
  return Object.freeze({
    name: identity.name,
    displayName: identity.displayName,
    productName: identity.productName ?? identity.displayName,
    configDirName: identity.configDirName ?? `.${identity.name}`,
    configFileName: CONFIG_FILE_NAME,
    envPrefix,
    repoSlug: identity.repoSlug,
  });
}

let current: ResolvedCliIdentity | undefined;
let currentVersion: string | undefined;

function sameIdentity(a: ResolvedCliIdentity, b: ResolvedCliIdentity): boolean {
  return (Object.keys(a) as (keyof ResolvedCliIdentity)[]).every((key) => a[key] === b[key]);
}

/**
 * Sets the process's CLI identity and the app's version. `createCli` calls it;
 * an app calls it itself only when it uses the library pieces without
 * `createCli`.
 *
 * Set once: a second call with a DIFFERENT identity or version throws, because
 * a process answering to two names (two config directories, two env prefixes)
 * is a bug. Repeating the same identity is a no-op. Tests replace it through
 * `@marinoscar/platform-cli/testing`.
 *
 * @param identity - The app's identity.
 * @param version - The app's own version (its package.json), shown by `--version`.
 * @throws Error when the identity is invalid or a different one is already set.
 * @stability experimental
 */
export function setCliIdentity(identity: CliIdentity, version: string): void {
  const resolved = resolveCliIdentity(identity);
  if (current !== undefined) {
    if (sameIdentity(current, resolved) && currentVersion === version) return;
    throw new Error(
      `The CLI identity is already set ("${current.name}"); it can be set once per process. ` +
        'Tests replace it with useTestCliIdentity from @marinoscar/platform-cli/testing.',
    );
  }
  current = resolved;
  currentVersion = version;
}

/**
 * The process's CLI identity.
 *
 * @returns The identity `createCli` (or `setCliIdentity`) set.
 * @throws Error when no identity has been set yet.
 * @stability experimental
 */
export function cliIdentity(): ResolvedCliIdentity {
  if (current === undefined) {
    throw new Error('No CLI identity is set: build the CLI with createCli({ identity, version }) (or call setCliIdentity) first.');
  }
  return current;
}

/**
 * Whether an identity has been set.
 *
 * @returns `true` once `createCli` or `setCliIdentity` ran.
 * @stability experimental
 */
export function hasCliIdentity(): boolean {
  return current !== undefined;
}

/**
 * The executable name, e.g. `appctl`.
 *
 * @returns `cliIdentity().name`.
 * @stability experimental
 */
export function cliName(): string {
  return cliIdentity().name;
}

/**
 * The human name for banners, e.g. `Acme CLI`.
 *
 * @returns `cliIdentity().displayName`.
 * @stability experimental
 */
export function cliDisplayName(): string {
  return cliIdentity().displayName;
}

/**
 * The env-var prefix, e.g. `APPCTL_`.
 *
 * @returns `cliIdentity().envPrefix`.
 * @stability experimental
 */
export function envPrefix(): string {
  return cliIdentity().envPrefix;
}

/**
 * The full name of one of this CLI's environment variables:
 * `envVar('TOKEN')` is `APPCTL_TOKEN`. Callers pass the suffix only and never
 * concatenate the prefix themselves, so lookups cannot drift from the names
 * printed in help text.
 *
 * @param suffix - The variable's suffix, e.g. `SERVER_URL`.
 * @returns The prefixed name.
 * @stability experimental
 */
export function envVar(suffix: string): string {
  return `${envPrefix()}${suffix}`;
}

/**
 * The per-user config directory NAME (not its path), e.g. `.appctl`.
 *
 * @returns `cliIdentity().configDirName`.
 * @stability experimental
 */
export function configDirName(): string {
  return cliIdentity().configDirName;
}

/**
 * Basename of the config file inside the config directory: `config.json`.
 *
 * @returns `cliIdentity().configFileName`.
 * @stability experimental
 */
export function configFileName(): string {
  return cliIdentity().configFileName;
}

/**
 * The app's own version, as passed to `createCli`.
 *
 * @returns The version, or `0.0.0-unknown` before an identity is set.
 * @stability experimental
 */
export function cliVersion(): string {
  return currentVersion ?? '0.0.0-unknown';
}

/**
 * Replaces the identity, bypassing set-once. For `/testing` only.
 *
 * @internal
 */
export function replaceCliIdentityForTests(identity: CliIdentity | undefined, version?: string): () => void {
  const previous = current;
  const previousVersion = currentVersion;
  current = identity === undefined ? undefined : resolveCliIdentity(identity);
  currentVersion = identity === undefined ? undefined : (version ?? previousVersion ?? '0.0.0-test');
  return () => {
    current = previous;
    currentVersion = previousVersion;
  };
}
