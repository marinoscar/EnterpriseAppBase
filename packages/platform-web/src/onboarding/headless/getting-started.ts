import { useCallback } from 'react';

import { useOnboarding } from './provider.js';

/**
 * The "Getting started" user-menu action.
 *
 * @stability experimental
 */
export interface GettingStartedAction {
  /** Show the menu item: under a provider, once the state has loaded. */
  visible: boolean;
  /** The item's label. */
  label: string;
  /** Clears the stored welcome and dismissals, so the dialog and the checklists return. Never throws. */
  run(): Promise<void>;
}

/**
 * The label of the "Getting started" action.
 *
 * @stability experimental
 */
export const GETTING_STARTED_LABEL = 'Getting started';

/**
 * The "Getting started" action for the app's own user menu.
 *
 * @returns the action.
 *
 * @example
 * ```tsx
 * const gettingStarted = useGettingStartedAction();
 * {gettingStarted.visible && <MenuItem onClick={() => void gettingStarted.run()}>{gettingStarted.label}</MenuItem>}
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function useGettingStartedAction(): GettingStartedAction {
  const { available, state, reopen } = useOnboarding();
  const run = useCallback(() => reopen(), [reopen]);
  return { visible: available && state !== null, label: GETTING_STARTED_LABEL, run };
}
