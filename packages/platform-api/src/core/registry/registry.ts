// =============================================================================
// Generic typed registry primitive (issue #675, PP-1.3)
// =============================================================================
//
// One implementation of "an additive, typed, string-keyed list", so every closed
// list the platform turns into a registry shares ONE duplicate rule, ONE
// ordering rule and ONE set of error codes. Those three things are the
// "registry behaviour: ordering, duplicate-id handling, error cases" that
// docs/specs/platform-packages.md promises apps can rely on; registry.spec.ts
// pins them.
//
// ⚠ FRAMEWORK-FREE ON PURPOSE. This file imports nothing: no `@nestjs/*`, no
// Prisma, no application code. Static registries are read where no Nest
// container exists: `prisma/seed.ts` under `ts-node --transpile-only`, the
// standalone `storage-purge.main.ts`, and DTO classes that `createZodDto()`
// builds while their module is evaluated (and that `npm run openapi:dump` reads
// in preview mode, where no provider is instantiated and no hook runs).
// registry.spec.ts reads this file and fails on any import.
//
// Two kinds of registry share it (README.md next to this file has the recipe):
//
//   - STATIC: `defineRegistry(...)` at module scope, filled at import time by
//     the registry's manifest, frozen by `RegistryFreezeService` once the Nest
//     application has bootstrapped. Never filled from `onModuleInit`: several
//     Nest applications share one module graph in a Jest worker, and the second
//     one would hit a frozen registry.
//   - INSTANCE: `new Registry(...)` held by an `@Injectable()`, filled from each
//     contributor's `onModuleInit` (`register(this)`), optionally frozen by its
//     owner in `onApplicationBootstrap` (see doctor/doctor-check.registry.ts).
// =============================================================================

/**
 * The default pattern every registry id must match: a letter or digit first,
 * then letters, digits and `. _ : / @ -`.
 *
 * It admits every id shape the codebase already uses (`db.connection`,
 * `jobs:read`, `auth.initial-admin`, `coach/weekly-review`) and rejects whitespace and a
 * leading separator. Override it per registry with {@link RegistryOptions.idPattern}.
 *
 * @stability stable
 */
export const DEFAULT_REGISTRY_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/;

/**
 * The longest id any registry accepts, in UTF-16 code units.
 *
 * @stability stable
 */
export const REGISTRY_ID_MAX_LENGTH = 128;

/**
 * Why a registry refused an operation. Stable: callers may switch on it.
 *
 * - `INVALID_ID`: the id is not a string, is empty, is longer than
 *   {@link REGISTRY_ID_MAX_LENGTH}, or fails the registry's id pattern.
 * - `INVALID_ENTRY`: the registry's `validate` hook threw.
 * - `DUPLICATE_ID`: the id is already registered and the policy is `'throw'`.
 * - `FROZEN`: a write after {@link Registry.freeze}.
 * - `UNKNOWN_ID`: {@link Registry.require} found no entry.
 * - `DUPLICATE_REGISTRY`: {@link defineRegistry} was given a name already in use.
 *
 * @stability stable
 */
export type RegistryErrorCode =
  | 'INVALID_ID'
  | 'INVALID_ENTRY'
  | 'DUPLICATE_ID'
  | 'FROZEN'
  | 'UNKNOWN_ID'
  | 'DUPLICATE_REGISTRY';

/**
 * The single error type every registry operation throws.
 *
 * @example
 * try {
 *   permissions.register(entry);
 * } catch (err) {
 *   if (err instanceof RegistryError && err.code === 'DUPLICATE_ID') { ... }
 * }
 *
 * @stability stable
 */
export class RegistryError extends Error {
  /** Machine-readable reason; see {@link RegistryErrorCode}. */
  readonly code: RegistryErrorCode;
  /** The `name` of the registry that refused the operation. */
  readonly registry: string;
  /** The entry id involved, when there is one. */
  readonly id?: string;

  /**
   * @param code - why the operation was refused.
   * @param registry - the refusing registry's name.
   * @param message - human-readable explanation.
   * @param details - the id involved and, for `INVALID_ENTRY`, the original error as `cause`.
   */
  constructor(
    code: RegistryErrorCode,
    registry: string,
    message: string,
    details: { id?: string; cause?: unknown } = {},
  ) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.name = 'RegistryError';
    this.code = code;
    this.registry = registry;
    if (details.id !== undefined) this.id = details.id;
  }
}

/**
 * How a registry identifies, checks, de-duplicates and orders its entries.
 *
 * @typeParam T - the entry type.
 *
 * @stability stable
 */
export interface RegistryOptions<T> {
  /**
   * Name used in errors and introspection, e.g. `'permissions'`. Must be unique
   * among registries created with {@link defineRegistry}.
   */
  name: string;
  /** Extracts the entry's id. Called once per registration. */
  idOf: (entry: T) => string;
  /**
   * Pattern every id must match. Default {@link DEFAULT_REGISTRY_ID_PATTERN}.
   * A `g` or `y` flag is ignored, so matching never depends on `lastIndex`.
   */
  idPattern?: RegExp;
  /**
   * Rejects an entry by throwing (any value). The throw is wrapped as
   * `INVALID_ENTRY`, keeping the original message and the original error as
   * `cause`. Runs after the id check and before the duplicate check. During
   * {@link Registry.registerAll} the registry passed in does not yet contain the
   * batch's earlier entries.
   */
  validate?: (entry: T, registry: Registry<T>) => void;
  /**
   * What a second entry with an existing id does. Default `'throw'`
   * (`DUPLICATE_ID`). `'replace'` keeps the NEW entry at the OLD entry's
   * position and calls {@link RegistryOptions.onReplace}.
   */
  onDuplicate?: 'throw' | 'replace';
  /**
   * Called for each replacement under `onDuplicate: 'replace'`, after the write
   * has been committed (never for a batch that was rejected).
   */
  onReplace?: (previous: T, next: T) => void;
  /**
   * Custom `DUPLICATE_ID` message. Default:
   * `Duplicate id "<id>" in registry "<name>".`
   */
  describeDuplicate?: (existing: T, incoming: T) => string;
  /**
   * The order of {@link Registry.list} and {@link Registry.ids}. Default
   * `'registration'`. `'id'` sorts by id in code-unit order (locale-independent,
   * so `'B'` sorts before `'a'`). A comparator sorts entries; ties keep
   * registration order.
   */
  order?: 'registration' | 'id' | ((a: T, b: T) => number);
}

/**
 * The introspection shape of {@link Registry.snapshot}.
 *
 * @stability stable
 */
export interface RegistrySnapshot {
  /** The registry's name. */
  name: string;
  /** Whether writes are refused. */
  frozen: boolean;
  /** Every id, in {@link Registry.list} order. */
  ids: string[];
}

/** Opaque saved state; see {@link Registry._captureState}. @internal */
export interface RegistryState<T> {
  readonly entries: ReadonlyMap<string, T>;
  readonly frozen: boolean;
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function messageOf(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * An additive, typed, string-keyed list with a duplicate policy, deterministic
 * order and an optional freeze.
 *
 * Entries are stored as given (never cloned); {@link list} and {@link ids}
 * return fresh arrays, so mutating them never changes the registry. Because the
 * registry holds references, entries should be `as const` or `Object.freeze`d
 * data.
 *
 * @typeParam T - the entry type.
 *
 * @example
 * const colours = new Registry<{ id: string; hex: string }>({
 *   name: 'colours',
 *   idOf: (c) => c.id,
 *   validate: (c) => {
 *     if (!/^#[0-9a-f]{6}$/i.test(c.hex)) throw new Error(`bad hex ${c.hex}`);
 *   },
 * });
 * colours.register({ id: 'brand', hex: '#3366ff' });
 * colours.require('brand').hex; // '#3366ff'
 *
 * @stability stable
 */
export class Registry<T> {
  /** The registry's name, as given in {@link RegistryOptions.name}. */
  readonly name: string;

  private entries = new Map<string, T>();
  private isFrozen = false;
  private readonly idPattern: RegExp;

  /**
   * @param options - see {@link RegistryOptions}.
   * @throws RegistryError `INVALID_ID` when `options.name` is empty.
   */
  constructor(private readonly options: RegistryOptions<T>) {
    if (typeof options.name !== 'string' || options.name.trim() === '') {
      throw new RegistryError('INVALID_ID', String(options.name), 'A registry name must be a non-empty string.');
    }
    this.name = options.name;
    const pattern = options.idPattern ?? DEFAULT_REGISTRY_ID_PATTERN;
    this.idPattern = new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ''));
  }

  /**
   * Adds one entry.
   *
   * @throws RegistryError `FROZEN`, `INVALID_ID`, `INVALID_ENTRY` or
   * `DUPLICATE_ID` (see {@link RegistryErrorCode}); the registry is unchanged
   * when it throws.
   */
  register(entry: T): void {
    this.registerAll([entry]);
  }

  /**
   * Adds every entry, all or nothing: each entry is checked (id, `validate`,
   * duplicates against the registry AND earlier entries of the same batch)
   * before any is added, so one bad entry rejects the whole batch and leaves the
   * registry unchanged.
   *
   * @throws RegistryError as {@link register}; the first failing entry wins.
   */
  registerAll(entries: readonly T[]): void {
    this.assertWritable();

    const staged = new Map(this.entries);
    const replacements: Array<[previous: T, next: T]> = [];

    for (const entry of entries) {
      const id = this.checkedId(entry);

      if (this.options.validate) {
        try {
          this.options.validate(entry, this);
        } catch (err) {
          throw new RegistryError(
            'INVALID_ENTRY',
            this.name,
            `Invalid entry "${id}" in registry "${this.name}": ${messageOf(err)}`,
            { id, cause: err },
          );
        }
      }

      if (staged.has(id)) {
        const existing = staged.get(id) as T;
        if ((this.options.onDuplicate ?? 'throw') === 'throw') {
          const message = this.options.describeDuplicate
            ? this.options.describeDuplicate(existing, entry)
            : `Duplicate id "${id}" in registry "${this.name}".`;
          throw new RegistryError('DUPLICATE_ID', this.name, message, { id });
        }
        replacements.push([existing, entry]);
      }

      // Map#set on an existing key keeps its insertion position: exactly the
      // "replace keeps the new entry at the OLD position" rule.
      staged.set(id, entry);
    }

    this.entries = staged;

    for (const [previous, next] of replacements) {
      this.options.onReplace?.(previous, next);
    }
  }

  /** The entry registered under `id`, or `undefined`. */
  get(id: string): T | undefined {
    return this.entries.get(id);
  }

  /**
   * The entry registered under `id`.
   *
   * @throws RegistryError `UNKNOWN_ID` when there is none.
   */
  require(id: string): T {
    const entry = this.entries.get(id);
    if (entry === undefined && !this.entries.has(id)) {
      const known = this.ids();
      const shown = known.length > 20 ? `${known.slice(0, 20).join(', ')}, ...` : known.join(', ');
      throw new RegistryError(
        'UNKNOWN_ID',
        this.name,
        `Unknown id "${id}" in registry "${this.name}". Known ids: ${shown || '(none)'}.`,
        { id },
      );
    }
    return entry as T;
  }

  /** Whether an entry is registered under `id`. */
  has(id: string): boolean {
    return this.entries.has(id);
  }

  /** Every id, as a fresh array, in {@link list} order. */
  ids(): string[] {
    return this.sortedEntries().map(([id]) => id);
  }

  /** Every entry, as a fresh array, in the order {@link RegistryOptions.order} names. */
  list(): T[] {
    return this.sortedEntries().map(([, entry]) => entry);
  }

  /** How many entries are registered. */
  get size(): number {
    return this.entries.size;
  }

  /** Refuses every later write with `FROZEN`. Reads keep working. Idempotent. */
  freeze(): void {
    this.isFrozen = true;
  }

  /** Whether {@link freeze} has been called. */
  get frozen(): boolean {
    return this.isFrozen;
  }

  /** Name, frozen state and ids, for logs, diagnostics and snapshot tests. */
  snapshot(): RegistrySnapshot {
    return { name: this.name, frozen: this.isFrozen, ids: this.ids() };
  }

  /**
   * Saves the entries and frozen state. For `testing.ts` only.
   * @internal
   */
  _captureState(): RegistryState<T> {
    return { entries: new Map(this.entries), frozen: this.isFrozen };
  }

  /**
   * Restores a state saved by {@link _captureState}. For `testing.ts` only.
   * @internal
   */
  _restoreState(state: RegistryState<T>): void {
    this.entries = new Map(state.entries);
    this.isFrozen = state.frozen;
  }

  /**
   * Allows writes again. For `testing.ts` only.
   * @internal
   */
  _unfreeze(): void {
    this.isFrozen = false;
  }

  private assertWritable(): void {
    if (this.isFrozen) {
      throw new RegistryError(
        'FROZEN',
        this.name,
        `Registry "${this.name}" is frozen: entries are registered before the application bootstraps.`,
      );
    }
  }

  private checkedId(entry: T): string {
    const id: unknown = this.options.idOf(entry);
    const fail = (why: string): never => {
      throw new RegistryError('INVALID_ID', this.name, `Invalid id ${JSON.stringify(id)} in registry "${this.name}": ${why}.`, {
        id: typeof id === 'string' ? id : undefined,
      });
    };

    if (typeof id !== 'string') return fail('an id must be a string');
    if (id.length === 0) return fail('an id must not be empty');
    if (id.length > REGISTRY_ID_MAX_LENGTH) return fail(`an id must be at most ${REGISTRY_ID_MAX_LENGTH} characters`);
    if (!this.idPattern.test(id)) return fail(`an id must match ${this.idPattern}`);
    return id;
  }

  private sortedEntries(): Array<[string, T]> {
    const pairs = [...this.entries];
    const order = this.options.order ?? 'registration';
    if (order === 'id') {
      pairs.sort(([a], [b]) => compareCodeUnits(a, b));
    } else if (typeof order === 'function') {
      pairs.sort(([, a], [, b]) => order(a, b));
    }
    return pairs;
  }
}

// -----------------------------------------------------------------------------
// The catalogue of static (module-level) registries
// -----------------------------------------------------------------------------

const definedRegistries = new Map<string, Registry<unknown>>();

/**
 * Creates a module-level ("static") registry and records it in the catalogue,
 * so {@link freezeDefinedRegistries} (called by `RegistryFreezeService` after
 * bootstrap) freezes it and {@link listDefinedRegistries} reports it.
 *
 * Call it once, at module scope, in the registry's own file; fill it from the
 * registry's manifest (see README.md next to this file).
 *
 * @param options - see {@link RegistryOptions}.
 * @returns the new registry.
 * @throws RegistryError `DUPLICATE_REGISTRY` when a defined registry already has that name.
 *
 * @example
 * // apps/api/src/common/permissions/permission.registry.ts
 * export const permissionRegistry = defineRegistry<PermissionDefinition>({
 *   name: 'permissions',
 *   idOf: (p) => p.id,
 * });
 *
 * @stability stable
 */
export function defineRegistry<T>(options: RegistryOptions<T>): Registry<T> {
  if (definedRegistries.has(options.name)) {
    throw new RegistryError(
      'DUPLICATE_REGISTRY',
      options.name,
      `A registry named "${options.name}" is already defined. Registry names must be unique.`,
    );
  }
  const registry = new Registry<T>(options);
  definedRegistries.set(registry.name, registry as Registry<unknown>);
  return registry;
}

/**
 * Every registry created with {@link defineRegistry}, in definition order.
 *
 * @stability stable
 */
export function listDefinedRegistries(): ReadonlyArray<Registry<unknown>> {
  return [...definedRegistries.values()];
}

/**
 * Freezes every registry created with {@link defineRegistry}. Idempotent.
 *
 * @stability stable
 */
export function freezeDefinedRegistries(): void {
  for (const registry of definedRegistries.values()) registry.freeze();
}

