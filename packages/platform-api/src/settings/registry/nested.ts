// =============================================================================
// Nested settings paths (PP-14.21)
// =============================================================================
//
// An extension can name a DOT PATH into an object field of a namespace
// (`query`, `assistant`, `a.b`) and add fields inside it. These are the pure
// helpers that do it, on schemas and on values:
//
//   - `parseSettingsPath`   a dot path into its segments, validated
//   - `extendSchemaAtPath`  a zod object with fields added at a path; throws
//                           on an existing LEAF key, not on the parent
//   - `getAtPath`/`setAtPath`/`deleteAtPath`  immutable access to a value
//
// Framework-free, zod only.
// =============================================================================

import { z } from 'zod';

/**
 * Any zod object schema.
 *
 * @stability experimental
 */
export type SettingsObjectSchema = z.ZodObject<z.ZodRawShape>;

const SEGMENT = /^[A-Za-z][A-Za-z0-9]*$/;

/**
 * Splits a dot path (`query`, `a.b`) into its segments.
 *
 * @param path - the dot path; `undefined` or `''` is the root.
 * @param what - what the path belongs to, for the error message.
 * @returns the segments (empty for the root).
 * @throws Error when a segment is not an identifier.
 *
 * @stability experimental
 */
export function parseSettingsPath(path: string | undefined, what: string): string[] {
  if (path === undefined || path === '') return [];
  const segments = path.split('.');
  for (const segment of segments) {
    if (!SEGMENT.test(segment)) {
      throw new Error(`${what}: path "${path}" is not a dot path of field names (bad segment "${segment}")`);
    }
  }
  return segments;
}

/** Maps the object inside optional and nullable wrappers; anything else cannot be extended. */
function mapObject(schema: z.ZodType, fn: (object: SettingsObjectSchema) => SettingsObjectSchema, what: string): z.ZodType {
  if (schema instanceof z.ZodObject) return fn(schema as SettingsObjectSchema);
  if (schema instanceof z.ZodOptional) return mapObject(schema.unwrap() as z.ZodType, fn, what).optional();
  if (schema instanceof z.ZodNullable) return mapObject(schema.unwrap() as z.ZodType, fn, what).nullable();
  throw new Error(`${what} must be a z.object to be extended`);
}

/**
 * `schema` with `added`'s fields added to the object at `path`.
 *
 * @param schema - the base schema (a `z.object` at the root).
 * @param path - the segments of the dot path; empty for the root.
 * @param added - the fields to add.
 * @param what - what the schema is, for the error message.
 * @returns the extended schema; the base is not modified.
 * @throws Error when a segment names no field, a segment is not an object, or the
 *   object at the path already declares one of the added keys.
 *
 * @stability experimental
 */
export function extendSchemaAtPath(
  schema: z.ZodType,
  path: readonly string[],
  added: SettingsObjectSchema,
  what: string,
): SettingsObjectSchema {
  return extendAt(schema, path, added, what) as SettingsObjectSchema;
}

function extendAt(schema: z.ZodType, path: readonly string[], added: SettingsObjectSchema, what: string): z.ZodType {
  return mapObject(
    schema,
    (object) => {
      if (path.length === 0) {
        for (const key of Object.keys(added.shape)) {
          if (key in object.shape) throw new Error(`${what} already declares "${key}"; an extension only adds fields`);
        }
        return object.extend(added.shape);
      }
      const [head, ...rest] = path as [string, ...string[]];
      const child = object.shape[head];
      if (child === undefined) {
        throw new Error(`${what} has no "${head}" field to extend (known: ${Object.keys(object.shape).join(', ')})`);
      }
      return object.extend({ [head]: extendAt(child as z.ZodType, rest, added, `${what}.${head}`) });
    },
    what,
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/**
 * The value at `path` of `value`, or `undefined` when a step is missing or not an object.
 *
 * @stability experimental
 */
export function getAtPath(value: unknown, path: readonly string[]): unknown {
  let current: unknown = value;
  for (const segment of path) {
    if (!isRecord(current)) return undefined;
    current = current[segment];
  }
  return current;
}

/**
 * A copy of `value` with `leaf` at `path`; the objects along the path are
 * copied (and created when missing), nothing else is touched.
 *
 * @stability experimental
 */
export function setAtPath(value: unknown, path: readonly string[], leaf: unknown): unknown {
  if (path.length === 0) return leaf;
  const [head, ...rest] = path as [string, ...string[]];
  const object = isRecord(value) ? value : {};
  return { ...object, [head]: setAtPath(object[head], rest, leaf) };
}

/** `value` with the keys `names` removed from the object at `path`; a value that is not an object there is returned as it was. */
export function omitAtPath(value: unknown, path: readonly string[], names: readonly string[]): unknown {
  const leaf = getAtPath(value, path);
  if (!isRecord(leaf)) return value;
  const rest = Object.fromEntries(Object.entries(leaf).filter(([key]) => !names.includes(key)));
  return setAtPath(value, path, rest);
}

/**
 * The schema at `path` of `schema`, walking object fields only. `undefined`
 * when a step is not an object or names no field.
 */
export function schemaAt(schema: z.ZodType, path: readonly string[]): z.ZodType | undefined {
  let current: z.ZodType | undefined = schema;
  for (const segment of path) {
    const object = unwrapToObject(current);
    if (object === undefined) return undefined;
    current = object.shape[segment] as z.ZodType | undefined;
    if (current === undefined) return undefined;
  }
  return current;
}

/** The object schema inside optional and nullable wrappers, or `undefined`. */
export function unwrapToObject(schema: z.ZodType | undefined): SettingsObjectSchema | undefined {
  let current = schema;
  for (let depth = 0; depth < 8 && current !== undefined; depth++) {
    if (current instanceof z.ZodObject) return current as SettingsObjectSchema;
    if (current instanceof z.ZodOptional || current instanceof z.ZodNullable) current = current.unwrap() as z.ZodType;
    else return undefined;
  }
  return undefined;
}
