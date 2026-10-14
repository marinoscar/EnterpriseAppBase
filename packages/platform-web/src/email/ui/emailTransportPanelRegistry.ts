// =============================================================================
// The email transport panel registry (PP-14.8)
// =============================================================================
//
// The admin email page (`/admin/settings/email`) lists one radio per email
// transport the API describes (`GET /api/email-settings`, `descriptors`) and
// draws the selected transport's form below it. WHICH component draws that form
// is decided here, by transport id:
//
//   - a transport with a REGISTERED panel gets that component. The two
//     built-ins (`ses`, `smtp`) register their bespoke panel
//     (`./builtinEmailTransportPanels.ts`), so their markup is exactly what it
//     was before this registry existed;
//   - every other transport gets `EmailGenericTransportPanel`, a form generated
//     from the descriptor the API serves for it. An app that adds a transport
//     with `registerEmailTransport` (`@marinoscar/platform-api/email`) therefore
//     needs no web code at all, and registers a panel here only to replace the
//     generated one.
//
// A registered panel is a presentation choice; it enforces nothing. The API
// validates every save (`EMAIL_TRANSPORT_SETTINGS_INVALID`, ...), and a secret
// is write-only whatever the panel does.
// =============================================================================

import type { EmailCredentialStatusDto } from '@marinoscar/platform-contract/email';
import type { PluggableDescriptor } from '@marinoscar/platform-contract/settings';
import type { ComponentType } from 'react';

import type { EmailSettings } from '../headless/index.js';

/**
 * What an email transport panel receives. The page owns the state and the
 * save; a panel only presents and collects, exactly as `PluggableConfigForm`
 * does.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface EmailTransportPanelProps {
  /** The transport's id (a panel shared by several transports reads which one it draws). */
  transport: string;
  /** The transport as the API described it: its label, and a field per setting and secret. */
  descriptor: PluggableDescriptor;
  /** The stored configuration, for read-only facts. */
  settings: EmailSettings;
  /** The transport's non-secret settings as edited so far (the shape `toForm` returned). */
  value: Readonly<Record<string, unknown>>;
  /** Reports one changed setting; `undefined` removes it (a cleared string is sent as `''`). */
  onChange: (name: string, next: unknown) => void;
  /** The typed replacement of each declared secret, by name; `''` keeps the stored one. Never seeded from the server. */
  secrets: Readonly<Record<string, string>>;
  /** Reports one typed secret. */
  onSecretChange: (name: string, next: string) => void;
  /** The masked status of each declared secret, by name: whether one is stored, its hint, and when it last changed. Never the value. */
  secretStatuses: Readonly<Record<string, EmailCredentialStatusDto>>;
  /** Field errors from the registered `validate`, by setting name. */
  errors: Readonly<Record<string, string>>;
  /** Whether the viewer may change the configuration; every control is disabled without it. */
  canWrite: boolean;
}

/**
 * A component that draws one email transport's form on the admin email page.
 * It receives {@link EmailTransportPanelProps}.
 *
 * @stability experimental
 */
export type EmailTransportPanelComponent = ComponentType<EmailTransportPanelProps>;

/**
 * Options of {@link registerEmailTransportPanel}.
 *
 * @stability experimental
 */
export interface EmailTransportPanelOptions {
  /**
   * Cheap, client-side checks of the SELECTED transport's settings, by setting
   * name. `enabled` is whether email is switched on (the required-field rules
   * apply only then). A non-empty result disables Save and is handed to the
   * panel as `errors`. The API is the validator; this only stops an obvious
   * typo round-tripping.
   */
  validate?: (value: Readonly<Record<string, unknown>>, context: { enabled: boolean }) => Record<string, string>;
  /**
   * Turns the settings the API stored into the shape the panel edits (the SMTP
   * panel edits the port as text). Default: the settings as they are.
   */
  toForm?: (settings: Readonly<Record<string, unknown>>) => Record<string, unknown>;
  /**
   * Turns the edited value back into the settings the API stores (the port as
   * a number). Default: the value, with a text setting nobody filled in sent
   * as `''` (the API merges over the stored settings, so an absent key would
   * keep the old value).
   */
  toInput?: (value: Readonly<Record<string, unknown>>) => Record<string, unknown>;
}

interface PanelEntry {
  Component: EmailTransportPanelComponent;
  options: EmailTransportPanelOptions;
}

const panels = new Map<string, PanelEntry>();
const builtinPanels = new Map<string, PanelEntry>();

/**
 * Registers the component that draws email transport `id`'s form on the admin
 * email page, replacing the generated form (and an earlier registration for the
 * same id, so a hot module reload that re-runs the registering module works).
 * Call it at module scope, before the page renders. An app's registration wins
 * over a built-in's whichever module loads first.
 *
 * Needed only for a bespoke form: a transport registered with
 * `registerEmailTransport` is drawn from its descriptor without it (its
 * settings, and a write-only field per declared secret).
 *
 * @param id - the transport id the panel is for (`'sendgrid'`).
 * @param Component - the panel; see {@link EmailTransportPanelProps} for its props.
 * @param options - optional client-side validation and value conversion.
 *
 * @example
 * ```tsx
 * import { registerEmailTransportPanel } from '@marinoscar/platform-web/email/ui/transport-panels';
 *
 * registerEmailTransportPanel('sendgrid', SendgridPanel);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerEmailTransportPanel(
  id: string,
  Component: EmailTransportPanelComponent,
  options: EmailTransportPanelOptions = {},
): void {
  panels.set(id, { Component, options });
}

/**
 * Registers a built-in transport's bespoke panel. Never replaces an app's
 * registration for the same id, so the result does not depend on which module
 * loaded first.
 *
 * @internal
 */
export function registerBuiltinEmailTransportPanel(
  id: string,
  Component: EmailTransportPanelComponent,
  options: EmailTransportPanelOptions = {},
): void {
  builtinPanels.set(id, { Component, options });
}

/**
 * The component registered for `id`, or `undefined` (the page then draws the
 * generated form).
 *
 * @param id - the transport id.
 * @stability experimental
 */
export function getEmailTransportPanel(id: string): EmailTransportPanelComponent | undefined {
  return (panels.get(id) ?? builtinPanels.get(id))?.Component;
}

/**
 * The options registered with `id`'s panel (`{}` when it has none).
 *
 * @param id - the transport id.
 * @stability experimental
 */
export function getEmailTransportPanelOptions(id: string): EmailTransportPanelOptions {
  return (panels.get(id) ?? builtinPanels.get(id))?.options ?? {};
}

/**
 * Forgets every app registration (tests only). The built-in panels stay.
 *
 * @internal
 */
export function resetEmailTransportPanelsForTests(): void {
  panels.clear();
}
