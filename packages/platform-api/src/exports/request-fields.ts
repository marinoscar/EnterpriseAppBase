// =============================================================================
// A source's request fields, derived from its zod schema (issue #744)
// =============================================================================
//
// The export dialog draws a source's options (a date range, a checkbox, a
// select) from `GET /api/exports/sources`, so the web app never carries a
// second copy of what a source accepts (kvox's "one declaration" rule). A
// source may declare `fields` itself; otherwise they are read from the top
// level of its `z.object` request schema:
//
//   z.boolean()                      -> boolean
//   z.enum([...])                    -> select (its values)
//   z.iso.date()                     -> date
//   any other string                 -> text
//
// `.optional()` / `.default()` make a field not required (a default is
// reported); `.describe()` is the description and `.meta({ title })` the
// label (else the key, humanised). Anything else is skipped: such a source
// should declare `fields`, or supply its own form (`slots.form` on the web).
// =============================================================================

import type { ExportRequestField } from '@marinoscar/platform-contract/exports';
import type { z } from 'zod';

type ZodDef = { type?: string; innerType?: unknown; defaultValue?: unknown; format?: string; entries?: Record<string, unknown> };

function defOf(schema: unknown): ZodDef {
  return ((schema as { _zod?: { def?: ZodDef } })?._zod?.def ?? {}) as ZodDef;
}

function humanise(key: string): string {
  const spaced = key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/**
 * The request fields of a source's schema. See the file header.
 *
 * @param schema - the source's request schema.
 * @returns one field per understood top-level key, in shape order.
 *
 * @example
 * ```ts
 * requestFieldsOf(z.object({ from: z.iso.date().optional() }));
 * // [{ key: 'from', label: 'From', kind: 'date', required: false }]
 * ```
 *
 * @stability experimental
 */
export function requestFieldsOf(schema: z.ZodType): ExportRequestField[] {
  const shape = (schema as { shape?: Record<string, unknown> }).shape;
  if (!shape || typeof shape !== 'object') return [];
  const fields: ExportRequestField[] = [];
  for (const [key, original] of Object.entries(shape)) {
    let node: unknown = original;
    let required = true;
    let defaultValue: unknown;
    for (let depth = 0; depth < 8; depth += 1) {
      const def = defOf(node);
      if (def.type === 'optional' || def.type === 'nullable') {
        required = false;
        node = def.innerType;
      } else if (def.type === 'default' || def.type === 'prefault') {
        required = false;
        const value = def.defaultValue;
        defaultValue = typeof value === 'function' ? (value as () => unknown)() : value;
        node = def.innerType;
      } else break;
    }
    const def = defOf(node);
    const meta = (original as { meta?: () => { title?: unknown } | undefined }).meta?.() ?? (node as { meta?: () => { title?: unknown } | undefined }).meta?.();
    const description =
      (original as { description?: string }).description ?? (node as { description?: string }).description;
    const base = {
      key,
      label: typeof meta?.title === 'string' ? meta.title : humanise(key),
      required,
      ...(description ? { description } : {}),
    };
    if (def.type === 'boolean') {
      fields.push({ ...base, kind: 'boolean', ...(typeof defaultValue === 'boolean' ? { default: defaultValue } : {}) });
    } else if (def.type === 'enum' && def.entries) {
      const values = Object.values(def.entries).map(String);
      fields.push({
        ...base,
        kind: 'select',
        options: values.map((value) => ({ value, label: humanise(value) })),
        ...(typeof defaultValue === 'string' ? { default: defaultValue } : {}),
      });
    } else if (def.type === 'string') {
      fields.push({
        ...base,
        kind: def.format === 'date' ? 'date' : 'text',
        ...(typeof defaultValue === 'string' ? { default: defaultValue } : {}),
      });
    }
  }
  return fields;
}
