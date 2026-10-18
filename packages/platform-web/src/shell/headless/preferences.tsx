// =============================================================================
// The shell preferences port (a host with no `/user-settings`)
// =============================================================================
//
// The rail's collapse preference lives in the viewer's `navigation`
// user-settings namespace by default (`useShellRailPreference`). A host with no
// API (a desktop shell) mounts `ShellPreferencesProvider` with a port that reads
// and writes the same values locally, and the rail then never touches the API.
// =============================================================================

import { createContext, useContext } from 'react';
import type { ReactElement, ReactNode } from 'react';

/**
 * The preferences the shell stores per viewer. Absent means the default.
 *
 * @stability experimental
 */
export interface ShellPreferences {
  /** The desktop rail is collapsed. Absent: expanded. */
  railCollapsed?: boolean;
}

/**
 * Where a host keeps {@link ShellPreferences}.
 *
 * @extensionPoint port
 * @stability experimental
 */
export interface ShellPreferencesPort {
  /** Reads the stored preferences (an empty object when none). */
  read(): ShellPreferences | Promise<ShellPreferences>;
  /** Stores the fields of `patch`; fields it omits are left as they are. */
  write(patch: Partial<ShellPreferences>): void | Promise<void>;
}

const ShellPreferencesContext = createContext<ShellPreferencesPort | null>(null);
ShellPreferencesContext.displayName = 'ShellPreferencesContext';

/**
 * Props of {@link ShellPreferencesProvider}.
 *
 * @stability experimental
 */
export interface ShellPreferencesProviderProps {
  /** The port; keep its identity stable. */
  port: ShellPreferencesPort;
  /** The tree. */
  children: ReactNode;
}

/**
 * Stores the shell's preferences through `port` instead of `/user-settings`.
 * Mount it for the whole life of the shell: `useShellRailPreference` picks its
 * source from whether a provider is mounted.
 *
 * @param props - see {@link ShellPreferencesProviderProps}.
 * @returns the provider element.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function ShellPreferencesProvider({ port, children }: ShellPreferencesProviderProps): ReactElement {
  return <ShellPreferencesContext.Provider value={port}>{children}</ShellPreferencesContext.Provider>;
}

/**
 * The preferences port in context, or `null` when no
 * {@link ShellPreferencesProvider} is mounted.
 *
 * @returns the port, or `null`.
 *
 * @stability experimental
 */
export function useOptionalShellPreferencesPort(): ShellPreferencesPort | null {
  return useContext(ShellPreferencesContext);
}

/**
 * A port over `window.localStorage`: one JSON object under `key`. Every storage
 * access is guarded, so a blocked or full store reads as "no preferences" and
 * a failed write is dropped; the shell then keeps the choice for the session.
 *
 * @param key - the storage key. Default `'shell-preferences'`.
 * @returns the port.
 *
 * @example
 * ```tsx
 * const port = createLocalStorageShellPreferencesPort('myapp.shell');
 * <ShellPreferencesProvider port={port}>...</ShellPreferencesProvider>
 * ```
 *
 * @stability experimental
 */
export function createLocalStorageShellPreferencesPort(key = 'shell-preferences'): ShellPreferencesPort {
  const readAll = (): ShellPreferences => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw === null) return {};
      const parsed: unknown = JSON.parse(raw);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
      const railCollapsed = (parsed as { railCollapsed?: unknown }).railCollapsed;
      return typeof railCollapsed === 'boolean' ? { railCollapsed } : {};
    } catch {
      return {};
    }
  };
  return {
    read: readAll,
    write(patch) {
      try {
        window.localStorage.setItem(key, JSON.stringify({ ...readAll(), ...patch }));
      } catch {
        // Storage unavailable: the preference lasts for the session only.
      }
    },
  };
}
