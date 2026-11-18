// =============================================================================
// Org settings field renderers: the `other` kind, drawn by the app (PP-14.21)
// =============================================================================
//
// `GET /api/org-settings` describes each field of an org-overridable namespace
// as a boolean, enum, number or string (the page draws a control) or `other`
// (an object, a record: the page cannot edit it generically and says it is
// managed elsewhere). An app that adds such a field to an org layer, with an
// extension at a nested path for example, draws it itself:
//
//   registerOrgSettingsFieldRenderer('telemetry', 'query', SlowQueryControl);
//
// The renderer replaces the page's note for that one field; every other field
// keeps the generated control. With none registered the page is unchanged.
// =============================================================================

import type { OrgSettingsField } from '@marinoscar/platform-contract/settings';
import type { ComponentType } from 'react';

/**
 * What a registered org field renderer receives.
 *
 * @stability experimental
 */
export interface OrgSettingsFieldRendererProps {
  /** The namespace key (`telemetry`). */
  namespace: string;
  /** The field's descriptor from `GET /api/org-settings` (its `name`, `kind: 'other'`). */
  field: OrgSettingsField;
  /**
   * The organization's value: the draft being edited, else the stored one,
   * else `undefined` (the organization inherits the deployment's).
   */
  value: unknown;
  /** The effective value: what applies when the organization stores none. */
  inherited: unknown;
  /** Whether the control must be read-only (no write permission, or a read-only namespace, or a save in flight). */
  disabled: boolean;
  /** Reports a new value for the field; `null` removes the override (the deployment's value applies again). */
  onChange: (next: unknown) => void;
}

const renderers = new Map<string, ComponentType<OrgSettingsFieldRendererProps>>();

const keyOf = (namespace: string, field: string): string => `${namespace}\u0000${field}`;

/**
 * Registers how the organization settings page draws one `other` field of one
 * namespace. Call at module scope, before the page renders. Registering the
 * same field again replaces its renderer in place (a hot module reload re-runs
 * the registering module).
 *
 * @param namespace - the namespace key the API describes.
 * @param field - the field name inside it (for a nested org field, the path root: `query`).
 * @param Component - the control; see {@link OrgSettingsFieldRendererProps}.
 * @returns a function that removes the registration (for a test).
 *
 * @example
 * ```ts
 * registerOrgSettingsFieldRenderer('telemetry', 'query', ({ value, onChange, disabled }) => (
 *   <SlowQueryField value={value} onChange={onChange} disabled={disabled} />
 * ));
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerOrgSettingsFieldRenderer(
  namespace: string,
  field: string,
  Component: ComponentType<OrgSettingsFieldRendererProps>,
): () => void {
  const key = keyOf(namespace, field);
  renderers.set(key, Component);
  return () => {
    if (renderers.get(key) === Component) renderers.delete(key);
  };
}

/**
 * The renderer registered for a field, if any.
 *
 * @param namespace - the namespace key.
 * @param field - the field name.
 * @returns the component, or `undefined` (the page shows its note).
 *
 * @stability experimental
 */
export function orgSettingsFieldRenderer(
  namespace: string,
  field: string,
): ComponentType<OrgSettingsFieldRendererProps> | undefined {
  return renderers.get(keyOf(namespace, field));
}
