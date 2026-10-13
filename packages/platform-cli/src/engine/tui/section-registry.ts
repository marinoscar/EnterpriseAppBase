import type { ComponentType } from 'react';

import { createCliRegistry } from '../../core/index.js';

// =============================================================================
// TUI screen sections  (PP-14.22)
// =============================================================================
//
// The platform's `node` and `deploy` screens are closed components: an app that
// wants one more line on them (its own fleet note under the worker-node list,
// a deploy hint under the deploy actions) had to fork the screen. A SECTION is
// an ink component the app registers for one of those screens; the screen
// renders every registered section below its own content, in registration
// order, on its top-level list. A section is read-only presentation: it does
// not receive the screen's state, cannot add a menu action and cannot take over
// the keyboard on the platform's behalf (it may use `useInput` like any ink
// component, which is its own responsibility).
//
// PURE ON PURPOSE, like screen-registry.ts: React is imported as a type only,
// so registering a section from `createCli` never loads ink. The component is
// either given directly or loaded when the screen opens (`load`).
// =============================================================================

/**
 * The screens that render registered sections.
 *
 * @stability experimental
 */
export const TUI_SECTION_SCREENS: readonly string[] = Object.freeze(['node', 'deploy']);

/**
 * What a section component is given.
 *
 * @stability experimental
 */
export interface TuiSectionProps {
  /** The screen it is rendered in: `node` or `deploy`. */
  screen: string;
}

/**
 * A section of a built-in TUI screen.
 *
 * @stability experimental
 */
export interface TuiSectionRegistration {
  /** `node` or `deploy`. */
  screen: string;
  /** Unique within the screen: lowercase `[a-z0-9-]`. */
  id: string;
  /** The component. Give this OR `load`. */
  component?: ComponentType<TuiSectionProps> | undefined;
  /** Loads the component when the screen opens, so ink stays out of non-TUI runs. */
  load?: (() => Promise<ComponentType<TuiSectionProps>>) | undefined;
}

const ID_PATTERN = /^[a-z][a-z0-9-]*$/;

const registry = createCliRegistry<TuiSectionRegistration & { key: string }>({
  name: 'TUI screen section',
  registerFn: 'registerTuiScreenSection',
  idOf: (entry) => entry.key,
  validate: (entry) => {
    if (!TUI_SECTION_SCREENS.includes(entry.screen)) {
      throw new Error(
        `TUI screen "${String(entry.screen)}" has no section slot. Screens with one: ${TUI_SECTION_SCREENS.join(', ')}. ` +
          'An app screen composes its own content.',
      );
    }
    if (typeof entry.id !== 'string' || !ID_PATTERN.test(entry.id)) {
      throw new Error(`TUI section id "${String(entry.id)}" is invalid: use lowercase letters, digits and hyphens.`);
    }
    const hasComponent = typeof entry.component === 'function' || (typeof entry.component === 'object' && entry.component !== null);
    if (hasComponent === (typeof entry.load === 'function')) {
      throw new Error(`TUI section "${entry.screen}:${entry.id}" needs exactly one of component or load.`);
    }
  },
});

/**
 * Adds a section to the `node` or `deploy` TUI screen.
 *
 * @param screenId - `node` or `deploy`.
 * @param section - The component, or `{ id, load }` to load it when the screen opens.
 * @param options - `id`, unique within the screen (default: the component's name).
 * @throws Error when the screen has no slot, the id is malformed or taken, or `createCli` has already built the CLI.
 * @stability experimental
 * @extensionPoint registry
 * @example
 * ```ts
 * registerTuiScreenSection('node', FleetNote, { id: 'fleet-note' });
 * registerTuiScreenSection('deploy', { id: 'release-hint', load: async () => (await import('./hint.js')).Hint });
 * ```
 */
export function registerTuiScreenSection(
  screenId: string,
  section: ComponentType<TuiSectionProps> | { id: string; load: () => Promise<ComponentType<TuiSectionProps>> },
  options: { id?: string | undefined } = {},
): void {
  const lazy = typeof section === 'object' && section !== null && 'load' in section;
  const id = options.id ?? (lazy ? section.id : ((section as { displayName?: string }).displayName ?? section.name ?? ''))
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .toLowerCase();
  registry.register({
    key: `${screenId}:${id}`,
    screen: screenId,
    id,
    ...(lazy ? { load: section.load } : { component: section as ComponentType<TuiSectionProps> }),
  });
}

/**
 * The sections registered for a screen, in registration order.
 *
 * @param screenId - `node` or `deploy`.
 * @returns A frozen copy.
 * @stability experimental
 */
export function listTuiScreenSections(screenId: string): readonly TuiSectionRegistration[] {
  return Object.freeze(registry.list().filter((entry) => entry.screen === screenId));
}

/** Refuses later registrations; `createCli` calls it. */
export function freezeTuiSectionRegistry(by: string): void {
  registry.freeze(by);
}

/** Empties the registry. Tests only. */
export function resetTuiSectionRegistryForTests(): void {
  registry.reset();
}
