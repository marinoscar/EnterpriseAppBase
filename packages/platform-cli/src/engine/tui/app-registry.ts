import { createCliRegistry } from '../../core/index.js';

// =============================================================================
// Selections and state loaders of the TUI app context  (RETRO-G1.2, #1066)
// =============================================================================
//
// Two registries an app fills before the TUI starts:
//
//   - a SELECTION is the thing the app works "inside of" (MemoriaHub: the
//     active circle; another app: the active project). The frame header shows
//     the chosen item as a chip, and every screen reads it with
//     `useTuiSelection(id)`.
//   - a STATE LOADER loads app data ONCE for all screens (a database handle,
//     a folder count, update info) and is read with `useTuiState(id)`.
//
// PURE ON PURPOSE, like screen-registry.ts: React and ink appear nowhere here,
// so `createCli({ tuiSelections, tuiStateLoaders })` records them without
// loading the UI. The provider (context.tsx) runs them.
// =============================================================================

/**
 * What a selection or state loader is told when it runs. Never carries the token.
 *
 * @stability experimental
 */
export interface TuiLoaderContext {
  /** Whether a token is stored. */
  loggedIn: boolean;
  /** The server the CLI is configured for. */
  serverUrl: string | undefined;
  /** Aborted when the provider unmounts or a `session.refresh()` supersedes this run. */
  signal: AbortSignal;
}

/**
 * An app-defined selection slot.
 *
 * @typeParam T - The selectable item.
 * @stability experimental
 */
export interface TuiSelectionRegistration<T = unknown> {
  /** Unique id, lowercase `[a-z0-9-]`; also the key under `tui.selection.<id>` in the CLI config. */
  id: string;
  /** The chip's label in the frame header, e.g. `Circle`. */
  label: string;
  /** Loads the choices. Runs on mount and again after `session.refresh()`. */
  load: (context: TuiLoaderContext) => Promise<readonly T[]>;
  /** The chip's text for an item. */
  display: (item: T) => string;
  /**
   * A stable string identifying an item, used to restore a persisted choice.
   * Defaults to `display(item)`; give it when two items can share a display text.
   */
  keyOf?: ((item: T) => string) | undefined;
  /** `config` keeps the choice in the CLI config file (`tui.selection.<id>`); `none` (the default) does not. */
  persist?: 'config' | 'none' | undefined;
}

/**
 * An app-defined loader of data shared by every screen.
 *
 * @typeParam T - The loaded value.
 * @stability experimental
 */
export interface TuiStateLoaderRegistration<T = unknown> {
  /** Unique id, lowercase `[a-z0-9-]`. */
  id: string;
  /** Loads the value. Runs on mount and again after `session.refresh()`. */
  load: (context: TuiLoaderContext) => Promise<T>;
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

function validateId(kind: string, id: unknown): void {
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new Error(`TUI ${kind} id "${String(id)}" is invalid: use lowercase letters, digits and hyphens.`);
  }
}

const selections = createCliRegistry<TuiSelectionRegistration>({
  name: 'TUI selection',
  registerFn: 'registerTuiSelection',
  idOf: (entry) => entry.id,
  validate: (entry) => {
    validateId('selection', entry.id);
    if (typeof entry.label !== 'string' || entry.label.trim() === '') {
      throw new Error(`TUI selection "${entry.id}" needs a label.`);
    }
    if (typeof entry.load !== 'function' || typeof entry.display !== 'function') {
      throw new Error(`TUI selection "${entry.id}" needs load and display functions.`);
    }
    if (entry.persist !== undefined && entry.persist !== 'config' && entry.persist !== 'none') {
      throw new Error(`TUI selection "${entry.id}": persist must be 'config' or 'none'.`);
    }
  },
});

const stateLoaders = createCliRegistry<TuiStateLoaderRegistration>({
  name: 'TUI state loader',
  registerFn: 'registerTuiStateLoader',
  idOf: (entry) => entry.id,
  validate: (entry) => {
    validateId('state loader', entry.id);
    if (typeof entry.load !== 'function') throw new Error(`TUI state loader "${entry.id}" needs a load function.`);
  },
});

/**
 * Declares a selection: shown as a chip in the TUI header, read by screens
 * with `useTuiSelection(id)`. None registered means no chip.
 *
 * @typeParam T - The selectable item.
 * @param selection - The id, label, loader, display function and persistence.
 * @throws Error when the id is malformed or taken, the shape is wrong, or `createCli` has already built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerTuiSelection<Project>({
 *   id: 'project',
 *   label: 'Project',
 *   persist: 'config',
 *   load: async () => (await listProjects()),
 *   display: (project) => project.name,
 *   keyOf: (project) => project.id,
 * });
 * ```
 */
export function registerTuiSelection<T>(selection: TuiSelectionRegistration<T>): void {
  selections.register(selection as unknown as TuiSelectionRegistration);
}

/**
 * The selections registered so far, in registration order.
 *
 * @returns A frozen copy.
 * @stability experimental
 */
export function listTuiSelections(): readonly TuiSelectionRegistration[] {
  return selections.list();
}

/**
 * Declares data loaded once for every screen, read with `useTuiState(id)`.
 *
 * @typeParam T - The loaded value.
 * @param loader - The id and the loader.
 * @throws Error when the id is malformed or taken, or `createCli` has already built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerTuiStateLoader({ id: 'update-info', load: async () => checkForUpdate() });
 * ```
 */
export function registerTuiStateLoader<T>(loader: TuiStateLoaderRegistration<T>): void {
  stateLoaders.register(loader as unknown as TuiStateLoaderRegistration);
}

/**
 * The state loaders registered so far, in registration order.
 *
 * @returns A frozen copy.
 * @stability experimental
 */
export function listTuiStateLoaders(): readonly TuiStateLoaderRegistration[] {
  return stateLoaders.list();
}

/** Refuses later registrations; `createCli` calls it. */
export function freezeTuiAppRegistries(by: string): void {
  selections.freeze(by);
  stateLoaders.freeze(by);
}

/** Empties both registries. Tests only. */
export function resetTuiAppRegistriesForTests(): void {
  selections.reset();
  stateLoaders.reset();
}
