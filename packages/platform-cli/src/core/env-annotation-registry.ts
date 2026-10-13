import { createCliRegistry } from './cli-registry.js';

// =============================================================================
// App annotations of a platform key  (PP-14.22)
// =============================================================================
//
// Each env key has exactly one owner (`registerEnvSpecFragment`), so an app
// could not change how the wizard treats a key the PLATFORM owns: pin
// `OTEL_SERVICE_NAME` for its product, or explain `EMAIL_FROM` in its own
// words. `annotateEnvKey` is the narrow, explicit exception.
//
// THE RULE: AN APP ANNOTATION WINS. For the two fields it may set, `fixed` and
// `help`, the app's value replaces the owner's. Everything else about the key
// (secret, never, validate, generate, group, allowBlank, essential) stays the
// owner's: an annotation can neither unmask a secret, resurrect a `never` key,
// weaken a validator nor move a key between groups. `fixed` on a SECRET key is
// refused at use, so a secret never ends up as a literal in source.
// =============================================================================

/**
 * What an app may set on a key it does not own.
 *
 * @stability experimental
 */
export interface EnvKeyAnnotation {
  /** Forced for a VPS deployment: not offered, not overridable by a prompt. Replaces the owner's `fixed`. */
  fixed?: string | undefined;
  /** Shown instead of the template's comment when the wizard asks. Plain text. */
  help?: string | undefined;
}

interface Entry {
  key: string;
  annotation: EnvKeyAnnotation;
}

const KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/;

const registry = createCliRegistry<Entry>({
  name: 'env key annotation',
  registerFn: 'annotateEnvKey',
  idOf: (entry) => entry.key,
  validate: (entry) => {
    if (typeof entry.key !== 'string' || !KEY_PATTERN.test(entry.key)) {
      throw new Error(`Env key ${JSON.stringify(entry.key)} is not a valid environment variable name.`);
    }
    const { fixed, help } = entry.annotation ?? {};
    if (fixed === undefined && help === undefined) {
      throw new Error(`annotateEnvKey("${entry.key}") sets neither fixed nor help.`);
    }
    if (fixed !== undefined && (typeof fixed !== 'string' || /[\r\n\u0000]/.test(fixed) || fixed.length > 1024)) {
      throw new Error(`annotateEnvKey("${entry.key}"): fixed must be a single-line string of at most 1024 characters.`);
    }
    if (help !== undefined && (typeof help !== 'string' || CONTROL.test(help) || help.length > 2000)) {
      throw new Error(`annotateEnvKey("${entry.key}"): help must be plain text (no control characters) of at most 2000 characters.`);
    }
  },
});

/**
 * Overrides the `fixed` value and/or the `help` text of an environment key,
 * including one a platform fragment owns. The app's value wins; see the module
 * notes for what an annotation cannot change.
 *
 * @param key - The environment variable name.
 * @param annotation - `fixed` and/or `help`.
 * @throws Error on a bad key or value, a key annotated twice, or after `createCli` built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * annotateEnvKey('OTEL_SERVICE_NAME', { fixed: 'coach-api' });
 * annotateEnvKey('EMAIL_FROM', { help: 'The address coaching reminders are sent from.' });
 * ```
 */
export function annotateEnvKey(key: string, annotation: EnvKeyAnnotation): void {
  registry.register(Object.freeze({ key, annotation: Object.freeze({ ...annotation }) }));
}

/**
 * The app's annotation of `key`, if it made one.
 *
 * @param key - An environment variable name.
 * @stability experimental
 */
export function getEnvAnnotation(key: string): EnvKeyAnnotation | undefined {
  return registry.get(key)?.annotation;
}

/**
 * Every annotated key, in registration order.
 *
 * @returns A frozen list of keys.
 * @stability experimental
 */
export function listEnvAnnotations(): readonly string[] {
  return Object.freeze(registry.list().map((entry) => entry.key));
}

/** Refuses later registrations; `createCli` calls it. */
export function freezeEnvAnnotationRegistry(by: string): void {
  registry.freeze(by);
}

/** Empties the registry. Tests only. */
export function resetEnvAnnotationRegistryForTests(): void {
  registry.reset();
}
