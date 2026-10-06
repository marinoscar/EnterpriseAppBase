// =============================================================================
// Env-spec fragment registry  (PP-4.5, #706)
// =============================================================================
//
// The deploy wizard gets its QUESTIONS from `.env.example` (the app's
// `parseEnvExample`). This registry supplies the GOOD question for the keys
// where it matters: mask it, generate it, validate it, compute it, gate it
// behind a feature group, or never ask at all. A fragment contributes
// METADATA for keys the template already declares; it never adds a key.
//
// One owner per key. A key claimed by two fragments throws at registration,
// naming both owners, because a silent "last one wins" would turn a fork's
// stray entry into a password that is suddenly prompted for, or a secret that
// is suddenly echoed. A host application that keeps a map of its own
// registers it as a fragment too, so the same rule covers it.
//
// Registration is explicit and grep-able, like the doctor and job registries:
// nothing here scans the filesystem or runs on import.
// =============================================================================

/**
 * How a generated value is made.
 *
 * - `base64-32`: 32 random bytes, standard base64 (AES-256 keys, JWT secrets).
 * - `hex-32`: 32 random bytes, lowercase hex. For values embedded in a syntax
 *   that reserves base64's own characters: GreptimeDB's
 *   `static_user_provider:cmd:user=password,user2=password2` splits on `,`,
 *   `=` and `:`, and base64 carries `=` padding (and `+`, `/`).
 *
 * @stability experimental
 */
export type GenerateKind = 'base64-32' | 'hex-32';

/**
 * What a `derive` function may read.
 *
 * @stability experimental
 */
export interface DeriveContext {
  /** The public hostname the deployment is being published under. */
  domain: string;
  /** Answers collected so far, in prompt order. */
  answers: ReadonlyMap<string, string>;
}

/**
 * The annotation for one environment key. Every field is optional: a key with
 * no entry at all is not secret, not essential, takes the template default and
 * gets its help text from the template's comments.
 *
 * @stability experimental
 */
export interface EnvVarMetadata {
  /** Never echoed, never logged, never rendered into a frame. */
  secret?: boolean;
  /** Asked even when the template supplies a default. */
  essential?: boolean;
  /** Offer to generate a value rather than make someone invent one. */
  generate?: GenerateKind;
  /**
   * Generate the value WITHOUT ASKING, interactive or not, whenever it is
   * blank or still a template placeholder (`isPlaceholderValue`). A real value
   * is never replaced. Requires `generate`.
   *
   * For credentials nobody needs to know, only the stack itself: the
   * GreptimeDB passwords are read back by the API from the same `.env`, so
   * asking an operator to invent them is friction and a reused password.
   */
  autoGenerate?: boolean;
  /** Returns a message when the value is unusable, undefined when it is fine. */
  validate?: (value: string) => string | undefined;
  /** Computed from the domain and earlier answers; never prompted for. */
  derive?: (context: DeriveContext) => string | undefined;
  /** Forced for a VPS deployment. Not offered, not overridable by a prompt. */
  fixed?: string;
  /**
   * Only asked when the operator opted into this feature group. A plain
   * string here; the host application narrows it to the groups it knows
   * (the reference CLI's `EnvGroup`) and refuses a fragment naming another.
   */
  group?: string;
  /** Never written at all, whatever the template says. */
  never?: boolean;
  /**
   * An EMPTY value is an acceptable answer for this key. Blank SKIPS
   * validation; a value that is present must still validate. "Not configured
   * yet" and "configured wrong" are different states, and only the first one
   * is allowed through.
   */
  allowBlank?: boolean;
}

/**
 * A named set of key annotations, contributed by a slice or by an app.
 *
 * @stability experimental
 */
export interface EnvSpecFragment {
  /** Unique across the process, e.g. `telemetry`. Named in every collision error. */
  id: string;
  /** Annotations by environment key. Keys must be unique across all fragments. */
  metadata: Readonly<Record<string, EnvVarMetadata>>;
}

const fragments: EnvSpecFragment[] = [];
/** Maps each key to the id of the fragment that owns it. */
const owners = new Map<string, string>();

/**
 * Registers a fragment of env-key metadata.
 *
 * Throws when a fragment with the same `id` is already registered, or when
 * any of its keys is already owned by another fragment; the message names
 * both owners. Nothing is registered when it throws.
 *
 * @param fragment - The fragment; its `id` and every key must be unique.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerEnvSpecFragment({ id: 'coach', metadata: { COACH_API_TOKEN: { secret: true } } });
 * ```
 */
export function registerEnvSpecFragment(fragment: EnvSpecFragment): void {
  if (typeof fragment.id !== 'string' || fragment.id.trim() === '') {
    throw new Error('An env-spec fragment needs a non-empty id.');
  }
  if (fragments.some((existing) => existing.id === fragment.id)) {
    throw new Error(`Env-spec fragment "${fragment.id}" is already registered.`);
  }
  for (const key of Object.keys(fragment.metadata)) {
    const owner = owners.get(key);
    if (owner !== undefined) {
      throw new Error(
        `Env key "${key}" is defined by env-spec fragment "${owner}" and again by "${fragment.id}". ` +
          'A key has exactly one owner: remove it from one of the two.',
      );
    }
  }
  fragments.push(fragment);
  for (const key of Object.keys(fragment.metadata)) owners.set(key, fragment.id);
}

/**
 * The registered annotation for `key`, or `undefined` when no fragment owns it.
 *
 * @param key - An environment variable name.
 * @returns The owning fragment's metadata for the key.
 * @stability experimental
 */
export function resolveEnvMetadata(key: string): EnvVarMetadata | undefined {
  const owner = owners.get(key);
  if (owner === undefined) return undefined;
  return fragments.find((fragment) => fragment.id === owner)?.metadata[key];
}

/**
 * Every registered fragment, in registration order.
 *
 * @returns A frozen copy of the list.
 * @stability experimental
 */
export function listEnvSpecFragments(): readonly EnvSpecFragment[] {
  return Object.freeze([...fragments]);
}

/**
 * Empties the registry. For tests only: production code never unregisters.
 *
 * @internal
 * @stability experimental
 */
export function resetEnvSpecRegistryForTests(): void {
  fragments.length = 0;
  owners.clear();
}
