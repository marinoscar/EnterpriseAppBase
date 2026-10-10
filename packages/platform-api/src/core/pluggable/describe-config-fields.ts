// =============================================================================
// Describing a zod object as configuration fields (PP-14.5, issue #923)
// =============================================================================
//
// A generated form cannot import a plugin's zod schema, so the API describes
// each field of a settings schema as one of five kinds: boolean, enum (with its
// options), number (with its bounds), string (with its maximum length) and
// `other` (anything else: the form shows a note instead of a control).
// Wrappers (`optional`, `nullable`, `readonly`, `nonoptional`) are unwrapped
// first. Generalised from the organization settings page's `describeOrgFields`
// (issue #733), which now delegates here and drops the two additions below, so
// its wire output is unchanged.
//
// Two additions over the org-settings description:
//   - `label`: from `.meta({ label: 'API base URL' })`, else the field name
//     humanised (`apiBaseUrl` -> `Api base url`).
//   - `help`:  from `.describe('...')` (the schema's description).
// Both are looked up on the field and on every wrapper around it, outermost
// first, so `z.string().describe('x').optional()` and
// `z.string().optional().describe('x')` read the same.
//
// The `secret` kind is never produced here: a secret is not a settings field
// (it lives in the encrypted credential store), so `PluggableKind.describe`
// adds it from the implementation's declared secrets.
// =============================================================================

import type { ConfigField } from '@marinoscar/platform-contract/settings';
import { z } from 'zod';

/**
 * A configuration field the description of a zod schema can produce (never `secret`).
 *
 * @stability experimental
 */
export type DescribedConfigField = Exclude<ConfigField, { kind: 'secret' }>;

const WRAPPERS = new Set(['optional', 'nullable', 'readonly', 'nonoptional']);
const MAX_WRAPPER_DEPTH = 8;

interface ZodInternals {
  _zod: { def: { type: string; innerType?: z.ZodType } };
}

/** The schema, then each wrapper's inner schema, outermost first, ending at the first non-wrapper. */
function unwrapChain(schema: z.ZodType): z.ZodType[] {
  const chain: z.ZodType[] = [schema];
  let current = schema;
  for (let depth = 0; depth < MAX_WRAPPER_DEPTH; depth++) {
    const def = (current as unknown as ZodInternals)._zod.def;
    if (!WRAPPERS.has(def.type) || def.innerType === undefined) break;
    current = def.innerType;
    chain.push(current);
  }
  return chain;
}

/** `apiBaseUrl` becomes `Api base url`; `max_retries` becomes `Max retries`; `region-id` becomes `Region id`. */
function humanise(name: string): string {
  const words = name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
    .toLowerCase();
  return words.length === 0 ? name : words.charAt(0).toUpperCase() + words.slice(1);
}

function labelOf(name: string, chain: readonly z.ZodType[]): string {
  for (const schema of chain) {
    const label = (schema.meta() as { label?: unknown } | undefined)?.label;
    if (typeof label === 'string' && label.trim() !== '') return label;
  }
  return humanise(name);
}

function helpOf(chain: readonly z.ZodType[]): string | undefined {
  for (const schema of chain) {
    const help = schema.description;
    if (typeof help === 'string' && help.trim() !== '') return help;
  }
  return undefined;
}

/**
 * The descriptor of one field.
 *
 * @param name - the field's key in its object schema.
 * @param schema - the field's zod schema.
 * @returns the descriptor: `name`, `kind` and the kind's bounds, then `label`
 *   and, when the schema has a description, `help`.
 *
 * @stability experimental
 */
export function describeConfigField(name: string, schema: z.ZodType): DescribedConfigField {
  const chain = unwrapChain(schema);
  const inner = chain[chain.length - 1] as z.ZodType;
  const label = labelOf(name, chain);
  const help = helpOf(chain);
  const tail = help === undefined ? { label } : { label, help };

  if (inner instanceof z.ZodBoolean) return { name, kind: 'boolean', ...tail };
  if (inner instanceof z.ZodEnum) {
    return { name, kind: 'enum', options: (inner.options as readonly unknown[]).map(String), ...tail };
  }
  if (inner instanceof z.ZodNumber) {
    const bounds: { min?: number; max?: number; integer?: true } = {};
    if (Number.isFinite(inner.minValue)) bounds.min = inner.minValue as number;
    if (Number.isFinite(inner.maxValue)) bounds.max = inner.maxValue as number;
    if (inner.isInt) bounds.integer = true;
    return { name, kind: 'number', ...bounds, ...tail };
  }
  if (inner instanceof z.ZodString) {
    return typeof inner.maxLength === 'number'
      ? { name, kind: 'string', maxLength: inner.maxLength, ...tail }
      : { name, kind: 'string', ...tail };
  }
  return { name, kind: 'other', ...tail };
}

/**
 * The descriptors of every field of an object schema, in declaration order.
 *
 * Use it to render a form for a schema the form cannot import. For a pluggable
 * implementation use {@link PluggableKind.describe}, which also adds the
 * implementation's secrets.
 *
 * @param schema - the object schema (an implementation's `settingsSchema`).
 * @returns one descriptor per field.
 *
 * @example
 * ```ts
 * describeConfigFields(z.object({ region: z.string().max(32).describe('Cloud region'), retries: z.number().int().min(0) }));
 * // [{ name: 'region', kind: 'string', maxLength: 32, label: 'Region', help: 'Cloud region' },
 * //  { name: 'retries', kind: 'number', min: 0, integer: true, label: 'Retries' }]
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export function describeConfigFields(schema: z.ZodObject<z.ZodRawShape>): DescribedConfigField[] {
  return Object.entries(schema.shape as Record<string, z.ZodType>).map(([name, field]) => describeConfigField(name, field));
}
