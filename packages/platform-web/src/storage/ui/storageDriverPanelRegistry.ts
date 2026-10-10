// =============================================================================
// The storage driver panel registry (PP-14.7, issue #925)
// =============================================================================
//
// The admin storage page (`/admin/settings/storage`) lists one radio per
// storage driver the API describes (`GET /api/admin/storage-config`,
// `descriptors`) and draws the selected driver's form below it. WHICH component
// draws that form is decided here, by driver id:
//
//   - a driver with a REGISTERED panel gets that component. The three built-in
//     drivers (`s3`, `r2`, `s3compatible`) register their bespoke panel
//     (`./builtinStorageDriverPanels.ts`), so their markup is exactly what it
//     was before this registry existed;
//   - every other driver gets `StorageGenericDriverPanel`, a form generated
//     from the descriptor the API serves for it. An app that adds a driver with
//     `registerStorageDriver` (`@marinoscar/platform-api/storage`) therefore
//     needs no web code at all, and registers a panel here only to replace the
//     generated one.
//
// A registered panel is a presentation choice; it enforces nothing. The API
// validates every save (`STORAGE_DRIVER_SETTINGS_INVALID`, ...), and a secret
// is write-only whatever the panel does.
// =============================================================================

import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import type { ComponentType } from 'react';

import type { StorageConfigView } from '../headless/index.js';

/**
 * What a storage driver panel receives. The page owns the state and the save;
 * a panel only presents and collects, exactly as `PluggableConfigForm` does.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface StorageDriverPanelProps {
  /** The driver's id (a panel shared by several drivers, as the S3 family's is, reads which one it draws). */
  provider: string;
  /** The driver as the API described it: its label, and a field per setting and secret. */
  descriptor: PluggableDescriptor;
  /** The stored configuration, for read-only facts (`secretStatus`, `effectiveEndpoint`). */
  config: StorageConfigView;
  /** The driver's non-secret settings as edited so far. */
  value: Readonly<Record<string, unknown>>;
  /** Reports one changed setting; `undefined` removes it (a cleared string is sent as `''`). */
  onChange: (name: string, next: unknown) => void;
  /** The typed replacement of each declared secret, by name; `''` keeps the stored one. Never seeded from the server. */
  secrets: Readonly<Record<string, string>>;
  /** Reports one typed secret. */
  onSecretChange: (name: string, next: string) => void;
  /** Field errors from the registered `validate`, by setting name. */
  errors: Readonly<Record<string, string>>;
  /** Whether the viewer may change the configuration; every control is disabled without it. */
  canWrite: boolean;
}

/**
 * A component that draws one storage driver's form on the admin storage page.
 * It receives {@link StorageDriverPanelProps}.
 *
 * @stability experimental
 */
export type StorageDriverPanelComponent = ComponentType<StorageDriverPanelProps>;

/**
 * Options of {@link registerStorageDriverPanel}.
 *
 * @stability experimental
 */
export interface StorageDriverPanelOptions {
  /**
   * Cheap, client-side checks of the driver's settings, by setting name. A
   * non-empty result disables Save, Test connection and the provisioning
   * action and is handed to the panel as `errors`. The API is the validator;
   * this only stops an obvious typo round-tripping.
   */
  validate?: (value: Readonly<Record<string, unknown>>) => Record<string, string>;
}

interface PanelEntry {
  Component: StorageDriverPanelComponent;
  options: StorageDriverPanelOptions;
}

const panels = new Map<string, PanelEntry>();
const builtinPanels = new Map<string, PanelEntry>();

/**
 * Registers the component that draws storage driver `id`'s form on the admin
 * storage page, replacing the generated form (and an earlier registration for
 * the same id, so a hot module reload that re-runs the registering module
 * works). Call it at module scope, before the page renders. An app's
 * registration wins over a built-in's whichever module loads first.
 *
 * Needed only for a bespoke form: a driver registered with
 * `registerStorageDriver` is drawn from its descriptor without it (its
 * settings, and a write-only field per declared secret).
 *
 * @param id - the driver id the panel is for (`'local-fs'`).
 * @param Component - the panel; see {@link StorageDriverPanelProps} for its props.
 * @param options - optional client-side validation.
 *
 * @example
 * ```tsx
 * import { registerStorageDriverPanel } from '@marinoscar/platform-web/storage/ui/driver-panels';
 *
 * registerStorageDriverPanel('local-fs', LocalFsPanel);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerStorageDriverPanel(
  id: string,
  Component: StorageDriverPanelComponent,
  options: StorageDriverPanelOptions = {},
): void {
  panels.set(id, { Component, options });
}

/**
 * Registers a built-in driver's bespoke panel. Never replaces an app's
 * registration for the same id, so the result does not depend on which module
 * loaded first.
 *
 * @internal
 */
export function registerBuiltinStorageDriverPanel(
  id: string,
  Component: StorageDriverPanelComponent,
  options: StorageDriverPanelOptions = {},
): void {
  builtinPanels.set(id, { Component, options });
}

/**
 * The component registered for `id`, or `undefined` (the page then draws the
 * generated form).
 *
 * @param id - the driver id.
 * @stability experimental
 */
export function getStorageDriverPanel(id: string): StorageDriverPanelComponent | undefined {
  return (panels.get(id) ?? builtinPanels.get(id))?.Component;
}

/**
 * The client-side check registered with `id`'s panel, or `undefined`.
 *
 * @param id - the driver id.
 * @stability experimental
 */
export function getStorageDriverPanelValidator(id: string): StorageDriverPanelOptions['validate'] {
  return (panels.get(id) ?? builtinPanels.get(id))?.options.validate;
}

/**
 * Forgets every app registration (tests only). The built-in panels stay.
 *
 * @internal
 */
export function resetStorageDriverPanelsForTests(): void {
  panels.clear();
}
