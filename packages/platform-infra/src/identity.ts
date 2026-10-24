// =============================================================================
// Identity rendering: the app's names in the platform's files
// =============================================================================
//
// A handful of values in the infra files are the APP's, not the platform's:
// the worker variables carry the CLI's env prefix (`APPCTL_SERVER_URL` in the
// reference app, `EVOPATHCLI_SERVER_URL` in EvoPath), the API's OpenTelemetry
// service name defaults to `<slug>-api`, and the test database is named after
// the product. The package files carry placeholders instead, and
// `platform-infra sync` renders them before it writes.
//
// The syntax, `@@PLATFORM_<NAME>@@`, is chosen so Compose cannot misread it: it
// has no `$`, so it is never interpolated, and no `#`, so nginx and dotenv
// never read it as a comment. Rendering is a pure function of the text and the
// identity, and an already-rendered text contains no placeholder, so rendering
// it again changes nothing.
// =============================================================================

/**
 * The app's names, as the infra files use them.
 *
 * @stability experimental
 */
export interface InfraIdentity {
  /** The CLI executable, for example `appctl`. Lowercase letters, digits and hyphens. */
  readonly cliName: string;
  /** The CLI's environment-variable prefix, for example `APPCTL_`; derived from `cliName` by default. */
  readonly envPrefix: string;
  /** The API's default OpenTelemetry service name, `<slug>-api` by default. */
  readonly serviceName: string;
  /** The default worker image in `worker.compose.yml` and `.env.worker.example`. */
  readonly workerImage: string;
  /** The disposable test database in `test.compose.yml`, `<slug>_test` by default. */
  readonly testDatabase: string;
  /** The test database's container name, `<slug>-db-test` by default. */
  readonly testContainer: string;
}

/**
 * What an app supplies: the CLI name, and optionally the product name the
 * other defaults derive from, or any value outright.
 *
 * @stability experimental
 */
export interface InfraIdentityInput {
  /** The CLI executable. Required: it seeds the env prefix. */
  readonly cliName: string;
  /** The product's display name, slugified the way `@app/shared` does (`Acme Hub` to `acme-hub`). Defaults to a neutral `app`. */
  readonly productName?: string;
  /** Overrides the prefix derived from `cliName`. */
  readonly envPrefix?: string;
  /** Overrides `<slug>-api`. */
  readonly serviceName?: string;
  /** Overrides {@link DEFAULT_WORKER_IMAGE}. */
  readonly workerImage?: string;
  /** Overrides `<slug>_test`. */
  readonly testDatabase?: string;
  /** Overrides `<slug>-db-test`. */
  readonly testContainer?: string;
}

/**
 * The worker image an app gets until it names its own: a visible placeholder,
 * so a fleet started without `WORKER_IMAGE` fails on a pull nobody can mistake
 * for a real image. The platform publishes its images in #692.
 *
 * @stability experimental
 */
export const DEFAULT_WORKER_IMAGE = 'ghcr.io/OWNER/REPO-worker:latest';

/**
 * Every placeholder the package files may carry, and the identity field it
 * renders to.
 *
 * @stability experimental
 */
export const INFRA_PLACEHOLDERS: Readonly<Record<string, keyof InfraIdentity>> = Object.freeze({
  '@@PLATFORM_CLI_NAME@@': 'cliName',
  '@@PLATFORM_ENV_PREFIX@@': 'envPrefix',
  '@@PLATFORM_SERVICE_NAME@@': 'serviceName',
  '@@PLATFORM_WORKER_IMAGE@@': 'workerImage',
  '@@PLATFORM_TEST_DATABASE@@': 'testDatabase',
  '@@PLATFORM_TEST_CONTAINER@@': 'testContainer',
});

const PLACEHOLDER = /@@PLATFORM_[A-Z0-9_]+@@/g;
const CLI_NAME = /^[a-z][a-z0-9-]*$/;
const ENV_PREFIX = /^[A-Z_][A-Z0-9_]*_$/;
/** Safe inside a Compose `${VAR:-default}`, a YAML scalar, an nginx argument and a dotenv value. */
const SAFE_VALUE = /^[A-Za-z0-9._:/@+-]+$/;
const NEUTRAL_SLUG = 'app';

/** The slug rule of `packages/shared/index.js` (and `scripts/rename.mjs`), byte for byte. */
function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : NEUTRAL_SLUG;
}

/** The env prefix rule of `@marinoscar/platform-cli` (`packages/platform-cli/src/engine/identity.ts`: `appctl` to `APPCTL_`). */
function toEnvPrefix(cliName: string): string {
  const upper = cliName.toUpperCase().replace(/[^A-Z0-9]/g, '_');
  return /^[0-9]/.test(upper) ? `_${upper}_` : `${upper}_`;
}

/**
 * Derives every identity value from the CLI name and the product name, the
 * same way the reference app derives them at run time.
 *
 * @param input - The CLI name, optionally the product name and explicit overrides.
 * @returns The complete identity.
 * @throws Error when the CLI name or the env prefix has the wrong shape, or a
 *   value could break the file it is rendered into (whitespace, `$`, quotes, `@@`).
 * @stability experimental
 * @extensionPoint option
 * @example
 * ```ts
 * deriveInfraIdentity({ cliName: 'evopathcli', productName: 'EvoPath' }).envPrefix; // 'EVOPATHCLI_'
 * ```
 */
export function deriveInfraIdentity(input: InfraIdentityInput): InfraIdentity {
  if (!CLI_NAME.test(input.cliName)) {
    throw new Error(`platform-infra: cliName "${input.cliName}" must be lowercase letters, digits and hyphens, starting with a letter`);
  }
  const slug = slugify(input.productName ?? '');
  const identity: InfraIdentity = {
    cliName: input.cliName,
    envPrefix: input.envPrefix ?? toEnvPrefix(input.cliName),
    serviceName: input.serviceName ?? `${slug}-api`,
    workerImage: input.workerImage ?? DEFAULT_WORKER_IMAGE,
    testDatabase: input.testDatabase ?? `${slug.replace(/-/g, '_')}_test`,
    testContainer: input.testContainer ?? `${slug}-db-test`,
  };
  if (!ENV_PREFIX.test(identity.envPrefix)) {
    throw new Error(`platform-infra: envPrefix "${identity.envPrefix}" must be upper-case letters, digits and underscores, ending in "_"`);
  }
  for (const [field, value] of Object.entries(identity)) {
    if (!SAFE_VALUE.test(value) || value.includes('@@')) {
      throw new Error(`platform-infra: identity ${field} "${value}" cannot be rendered into a config file (use letters, digits and . _ : / @ + -)`);
    }
  }
  return identity;
}

/**
 * Replaces every `@@PLATFORM_*@@` placeholder with the app's value. Pure, and
 * idempotent: a rendered text has no placeholder left, so rendering it again
 * returns it unchanged.
 *
 * @param text - A package file's content.
 * @param identity - The app's identity; only the fields the text uses are read.
 * @param source - The file's name, for the error message.
 * @returns The rendered text.
 * @throws Error when the text carries a placeholder this package does not
 *   define, or one whose identity field is not supplied.
 * @stability experimental
 */
export function renderInfraText(text: string, identity: Partial<InfraIdentity>, source = 'text'): string {
  return text.replace(PLACEHOLDER, (placeholder) => {
    const field = INFRA_PLACEHOLDERS[placeholder];
    if (field === undefined) {
      throw new Error(`platform-infra: ${source} carries the unknown placeholder ${placeholder}`);
    }
    const value = identity[field];
    if (value === undefined) {
      throw new Error(`platform-infra: ${source} needs the app identity's ${field} (${placeholder}); pass it to sync`);
    }
    return value;
  });
}

/**
 * Whether a text carries any `@@PLATFORM_*@@` placeholder.
 *
 * @internal
 */
export function hasPlaceholder(text: string): boolean {
  return /@@PLATFORM_[A-Z0-9_]+@@/.test(text);
}
