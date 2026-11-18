// =============================================================================
// Document export options: one declaration, three consumers (from kvox
// `export-options.ts`, issue #28; packaged by #744)
// =============================================================================
//
// A document exporter's options have to be three things at once, and they are
// ONE declaration:
//
//   1. a zod schema, so a route validates the body (an unvalidated option
//      would reach a renderer as `undefined` and silently change the output);
//   2. a published description, so a dialog draws the checkboxes without a
//      second copy of the list;
//   3. a hash input, so two requests that render identical bytes reuse one
//      file (`hashExportRequest`).
//
// The schema is STRICT (an unknown key is a 400, never a stripped field: a
// typo'd option must not silently produce the default document), and the hash
// is over the PARSED options (defaults applied, keys sorted), never the raw
// body, so `{}` and `{ includeTimestamps: true }` hash the same when that is
// the default.
// =============================================================================

import { createHash } from 'node:crypto';

import { z } from 'zod';

/**
 * One option a document exporter accepts, as both a schema and a piece of UI.
 * Booleans only, on purpose: `type` is a union of one, so adding a kind later
 * is a compile error at every site that draws a field.
 *
 * @stability experimental
 */
export interface ExportOptionField {
  /** The key in the options object. Permanent once published. */
  readonly key: string;
  /** Sentence-case label for the dialog's checkbox. */
  readonly label: string;
  /** One line under the label saying what turning it on does. */
  readonly description: string;
  /** See the type's comment. */
  readonly type: 'boolean';
  /** The value when the request omits it. */
  readonly default: boolean;
}

/**
 * Options as every renderer receives them: defaults applied, nothing absent.
 *
 * @stability experimental
 */
export type ExportOptions = Record<string, boolean>;

/**
 * The schema {@link optionsSchemaFor} produces.
 *
 * @stability experimental
 */
export type ExportOptionsSchema = z.ZodType<ExportOptions, unknown>;

/**
 * The strict zod schema for a field list: every field optional with its
 * default, an unknown key refused.
 *
 * @param fields - the exporter's declared options.
 * @returns the schema.
 *
 * @example
 * ```ts
 * const schema = optionsSchemaFor([{ key: 'includeTimestamps', label: 'Timestamps', description: '…', type: 'boolean', default: true }]);
 * schema.parse({}); // { includeTimestamps: true }
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function optionsSchemaFor(fields: readonly ExportOptionField[]): ExportOptionsSchema {
  const shape: Record<string, z.ZodType<boolean, unknown>> = {};
  for (const field of fields) {
    shape[field.key] = z.boolean().default(field.default).describe(field.description) as unknown as z.ZodType<boolean, unknown>;
  }
  return z.strictObject(shape) as unknown as ExportOptionsSchema;
}

/**
 * The all-defaults options for a field list.
 *
 * @param fields - the exporter's declared options.
 * @returns every key at its default.
 *
 * @stability experimental
 */
export function defaultOptions(fields: readonly ExportOptionField[]): ExportOptions {
  return Object.fromEntries(fields.map((field) => [field.key, field.default]));
}

/**
 * A value as canonical JSON: object keys sorted, recursively, `undefined`
 * members dropped.
 *
 * @param value - any JSON-like value.
 * @returns its canonical text.
 *
 * @example
 * ```ts
 * canonicalJson({ b: 2, a: 1 }); // '{"a":1,"b":2}'
 * ```
 *
 * @stability experimental
 */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`);
  return `{${entries.join(',')}}`;
}

/**
 * A request's identity, for reusing an already-rendered document: SHA-256 of
 * the canonical `{ format, version, options, contentFingerprint? }`.
 * `format` and `version` are inside the hash even when a lookup also filters
 * on them, so a query that forgot one still cannot match a stale render.
 *
 * @param input - the format, the document version, the parsed options and an
 *   optional fingerprint of anything else that changes the output.
 * @returns the hex digest.
 *
 * @example
 * ```ts
 * hashExportRequest({ format: 'markdown', version: 3, options: { includeTimestamps: true } });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function hashExportRequest(input: {
  /** The format id. */
  format: string;
  /** The document's version. */
  version: number;
  /** The parsed options. */
  options: ExportOptions;
  /** Anything other than the version that changes what the file says; hashed only when present. */
  contentFingerprint?: string | null;
}): string {
  return createHash('sha256')
    .update(
      canonicalJson({
        format: input.format,
        version: input.version,
        options: input.options,
        ...(input.contentFingerprint ? { contentFingerprint: input.contentFingerprint } : {}),
      }),
    )
    .digest('hex');
}
