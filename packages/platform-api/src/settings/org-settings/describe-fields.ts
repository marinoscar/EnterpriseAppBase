// =============================================================================
// Org-overridable fields, described for a generated form (issue #733)
// =============================================================================
//
// The organization settings page cannot import an app's zod schemas, so the
// API describes each field of a namespace's `org.schema` as one of five kinds:
// boolean, enum (with its options), number (with its bounds), string (with its
// maximum length) and `other` (anything else: the page links to the owning
// slice's own page instead of rendering a control). Wrappers (`optional`,
// `nullable`, `readonly`) are unwrapped first.
// =============================================================================

import type { OrgSettingsField } from '@marinoscar/platform-contract/settings';
import { z } from 'zod';

const WRAPPERS = new Set(['optional', 'nullable', 'readonly', 'nonoptional']);

function unwrap(schema: z.ZodType): z.ZodType {
  let current = schema;
  for (let depth = 0; depth < 8; depth++) {
    const def = (current as unknown as { _zod: { def: { type: string; innerType?: z.ZodType } } })._zod.def;
    if (!WRAPPERS.has(def.type) || def.innerType === undefined) return current;
    current = def.innerType;
  }
  return current;
}

/** The descriptor of one field. */
export function describeOrgField(name: string, schema: z.ZodType): OrgSettingsField {
  const inner = unwrap(schema);
  if (inner instanceof z.ZodBoolean) return { name, kind: 'boolean' };
  if (inner instanceof z.ZodEnum) {
    return { name, kind: 'enum', options: (inner.options as readonly unknown[]).map(String) };
  }
  if (inner instanceof z.ZodNumber) {
    const field: OrgSettingsField = { name, kind: 'number' };
    if (Number.isFinite(inner.minValue)) field.min = inner.minValue as number;
    if (Number.isFinite(inner.maxValue)) field.max = inner.maxValue as number;
    if (inner.isInt) field.integer = true;
    return field;
  }
  if (inner instanceof z.ZodString) {
    const field: OrgSettingsField = { name, kind: 'string' };
    if (typeof inner.maxLength === 'number') field.maxLength = inner.maxLength;
    return field;
  }
  return { name, kind: 'other' };
}

/** The descriptors of every field of an `org.schema`, in declaration order. */
export function describeOrgFields(schema: z.ZodObject<z.ZodRawShape>): OrgSettingsField[] {
  return Object.entries(schema.shape as Record<string, z.ZodType>).map(([name, field]) => describeOrgField(name, field));
}
