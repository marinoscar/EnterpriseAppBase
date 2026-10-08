// =============================================================================
// The org layer: salvage and merge, pure functions (issue #733)
// =============================================================================
//
// How one organization's stored overrides are read (field by field, like the
// system document) and combined with the system value of a namespace. Shared
// by `OrgSettingsService` (the `effective` map of `GET /api/org-settings`)
// and `SettingsResolver` (every slice's read), so the route and the code can
// never disagree about what an organization's setting is.
//
// Framework-free: zod and the registry types only.
// =============================================================================

import type { z } from 'zod';

import type { SystemSettingsNamespace } from '../registry/system-settings-namespace';

/** `value` when it is a plain object, else `undefined`. */
export function asPlainObject(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

/**
 * One namespace's stored org fields, salvaged: every field the namespace's
 * `org.schema` declares that parses is kept, anything else (an unknown field,
 * a value that no longer validates) is dropped. `undefined` when nothing
 * usable is stored.
 */
export function readOrgFields(ns: SystemSettingsNamespace, stored: unknown): Record<string, unknown> | undefined {
  const org = ns.org;
  const source = asPlainObject(stored);
  if (!org || !source) return undefined;
  const fields: Record<string, unknown> = {};
  for (const [name, schema] of Object.entries(org.schema.shape as Record<string, z.ZodType>)) {
    if (source[name] === undefined) continue;
    const parsed = schema.safeParse(source[name]);
    if (parsed.success && parsed.data !== undefined) fields[name] = parsed.data;
  }
  return Object.keys(fields).length > 0 ? fields : undefined;
}

/**
 * The effective value of a namespace for one organization: `system` with the
 * org fields applied as the namespace's `org.merge` declares (`'override'`:
 * the org's fields replace the system's; a function: its result). A result
 * that fails the namespace's `storedSchema` falls back to `system`, so a
 * broken merge can never hand a slice an invalid value.
 *
 * @returns the effective value, and whether the org layer changed anything.
 */
export function applyOrgLayer<V>(
  ns: SystemSettingsNamespace,
  system: V,
  orgFields: Record<string, unknown> | undefined,
): { value: V; applied: boolean } {
  const org = ns.org;
  if (!org || orgFields === undefined || Object.keys(orgFields).length === 0) return { value: system, applied: false };
  const merged =
    org.merge === 'override'
      ? { ...(asPlainObject(system) ?? {}), ...structuredClone(orgFields) }
      : org.merge(structuredClone(system), structuredClone(orgFields) as Partial<V>);
  const parsed = ns.storedSchema.safeParse(merged);
  if (!parsed.success) return { value: system, applied: false };
  return { value: parsed.data as V, applied: true };
}
