// =============================================================================
// A small id-keyed registry for the CLI's extension points  (PP-14.22)
// =============================================================================
//
// The CLI's registries (commands, env-spec fragments, TUI screens, deploy
// steps, node executors) are module-level lists that `createCli` freezes once
// the CLI is built. The extension points added by PP-14.22 (env groups, deploy
// checks, proxy stream paths, edge-config files, compose modes, TUI sections,
// env generators, CLI conformance suites) share this one shape instead of
// repeating it eight times: string ids, a duplicate-id error, registration
// order, a freeze and a test reset.
// =============================================================================

/**
 * An id-keyed registry with the CLI's freeze-after-build rule.
 *
 * @stability experimental
 */
export interface CliRegistry<T> {
  /** Adds an entry; throws on a duplicate id, a failed validation or after the freeze. */
  register(entry: T): void;
  /** Every entry, in registration order. A frozen copy. */
  list(): readonly T[];
  /** The entry with this id, or undefined. */
  get(id: string): T | undefined;
  /** Refuses every later registration; `createCli` calls it. */
  freeze(by: string): void;
  /** Empties and unfreezes. Tests only. */
  reset(): void;
}

/**
 * Options of {@link createCliRegistry}.
 *
 * @stability experimental
 */
export interface CliRegistryOptions<T> {
  /** What the entries are called in errors, e.g. `deploy check`. */
  name: string;
  /** The registration function's name, named in the late-registration error. */
  registerFn: string;
  /** The entry's unique id. */
  idOf: (entry: T) => string;
  /** Throws (with a clear message) when the entry is unusable. */
  validate?: ((entry: T) => void) | undefined;
}

/**
 * Builds a {@link CliRegistry}.
 *
 * @param options - The entry name, the register function's name, the id and the validator.
 * @returns The registry.
 * @stability experimental
 */
export function createCliRegistry<T>(options: CliRegistryOptions<T>): CliRegistry<T> {
  const entries: T[] = [];
  let frozenBy: string | undefined;
  return {
    register(entry) {
      options.validate?.(entry);
      const id = options.idOf(entry);
      if (frozenBy !== undefined) {
        throw new Error(
          `${options.registerFn}("${String(id)}") was called after ${frozenBy}; register the ${options.name} before (or pass it to createCli).`,
        );
      }
      if (typeof id !== 'string' || id === '') {
        throw new Error(`A ${options.name} needs a non-empty id.`);
      }
      if (entries.some((existing) => options.idOf(existing) === id)) {
        throw new Error(`The ${options.name} "${id}" is already registered.`);
      }
      entries.push(entry);
    },
    list: () => Object.freeze([...entries]),
    get: (id) => entries.find((entry) => options.idOf(entry) === id),
    freeze(by) {
      frozenBy = by;
    },
    reset() {
      entries.length = 0;
      frozenBy = undefined;
    },
  };
}
