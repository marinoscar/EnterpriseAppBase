// =============================================================================
// The app's data model, structurally, and the columns an export may carry
// (issue #744)
// =============================================================================
//
// The `user-data` and `org-data` sources export ANY registered model, so they
// read its columns from the app's `Prisma.dmmf.datamodel`, passed in as
// `ExportsModule.forRoot({ datamodel })`. The package never imports a
// generated client (test/no-generated-client.spec.ts): the shapes below are
// the few DMMF members it reads.
//
// WHICH COLUMNS. Scalar and enum fields only (relations are other datasets),
// never `Bytes` (binary is ciphertext or a blob, never a user's readable
// data), minus the entry's `exportOmit` (the registry's redaction list,
// `exportRedact` in the story), minus EVERY field the default rule names:
// `secret`, `tokenHash`, `token_hash`, `password`, `hint`, and any name ending
// in `Secret`, `Hash`, `Ciphertext` or `Salt`. The default rule is the floor
// a registry entry cannot lower: a field named like a secret is never
// exported, whatever the entry says. The columns are also the `select`, so a
// redacted value never leaves the database.
// =============================================================================

import type { ExportCell, ExportColumn } from '@marinoscar/platform-contract/exports';

/**
 * One field of a model, as `Prisma.dmmf.datamodel` describes it.
 *
 * @stability experimental
 */
export interface ExportDatamodelField {
  /** The field name (`tokenHash`). */
  readonly name: string;
  /** `scalar`, `enum`, `object` (a relation) or `unsupported`. */
  readonly kind: string;
  /** The type name (`String`, `DateTime`, an enum or model name). */
  readonly type: string;
  /** Whether it is a list (absent in Prisma 7's trimmed runtime datamodel). */
  readonly isList?: boolean;
  /** Whether it is the model's single-field id (absent in Prisma 7's runtime datamodel; a field named `id` is assumed to be it). */
  readonly isId?: boolean;
}

/**
 * One model of `Prisma.dmmf.datamodel`.
 *
 * @stability experimental
 */
export interface ExportDatamodelModel {
  /** The model name (`PersonalAccessToken`). */
  readonly name: string;
  /** Its fields, in schema order. */
  readonly fields: readonly ExportDatamodelField[];
  /** A composite primary key, when the datamodel records one (Prisma 7's runtime datamodel does not). */
  readonly primaryKey?: { readonly fields: readonly string[] } | null;
}

/**
 * The app's `Prisma.dmmf.datamodel`, structurally.
 *
 * @stability experimental
 */
export interface ExportDatamodel {
  /** Every model. */
  readonly models: readonly ExportDatamodelModel[];
}

/**
 * Field names the default redaction rule removes whatever a registry entry
 * says.
 *
 * @stability experimental
 */
export const ALWAYS_REDACTED_EXPORT_FIELDS: readonly string[] = Object.freeze([
  'secret',
  'tokenHash',
  'token_hash',
  'password',
  'hint',
]);

/**
 * Name suffixes the default redaction rule removes (`clientSecret`,
 * `deviceCodeHash`, `linkTokenCiphertext`, `passwordSalt`).
 *
 * @stability experimental
 */
export const ALWAYS_REDACTED_EXPORT_SUFFIXES: readonly string[] = Object.freeze(['Secret', 'Hash', 'Ciphertext', 'Salt']);

/**
 * Whether the default redaction rule removes `field` from every export.
 *
 * @param field - a field name.
 * @returns `true` for a secret-like name.
 *
 * @example
 * ```ts
 * isRedactedExportField('tokenHash'); // true
 * isRedactedExportField('name'); // false
 * ```
 *
 * @stability experimental
 */
export function isRedactedExportField(field: string): boolean {
  if (ALWAYS_REDACTED_EXPORT_FIELDS.includes(field)) return true;
  return ALWAYS_REDACTED_EXPORT_SUFFIXES.some((suffix) => field.length > suffix.length && field.endsWith(suffix));
}

/**
 * `PersonalAccessToken` → `personal_access_token`: a model's dataset name.
 *
 * @param model - a PascalCase model name.
 * @returns the snake_case name.
 *
 * @stability experimental
 */
export function datasetNameOf(model: string): string {
  return model
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1_$2')
    .toLowerCase();
}

/**
 * `PersonalAccessToken` → `Personal access token`: a model's dataset title.
 *
 * @param model - a PascalCase model name.
 * @returns the title.
 *
 * @stability experimental
 */
export function datasetTitleOf(model: string): string {
  const words = datasetNameOf(model).split('_');
  const title = words.join(' ');
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** `createdAt` → `Created at`. */
function labelOf(field: string): string {
  const spaced = field
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const NUMERIC = new Set(['Int', 'BigInt', 'Float', 'Decimal']);

/**
 * The exportable columns of `model`: scalar and enum fields, never `Bytes`,
 * minus `omit` and minus every name {@link isRedactedExportField} matches.
 *
 * @param model - the model, from the app's datamodel.
 * @param omit - the registry entry's `exportOmit` (the story's `exportRedact`).
 * @returns the columns, in schema order.
 *
 * @example
 * ```ts
 * exportColumnsOf(datamodel.models.find((m) => m.name === 'UserAiKey')!, ['secret']).map((c) => c.key);
 * // ['id', 'userId', 'provider', ...] (no secret, no hint)
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function exportColumnsOf(model: ExportDatamodelModel, omit: readonly string[] = []): ExportColumn[] {
  return model.fields
    .filter((field) => field.kind === 'scalar' || field.kind === 'enum')
    .filter((field) => field.type !== 'Bytes')
    .filter((field) => !omit.includes(field.name) && !isRedactedExportField(field.name))
    .map((field): ExportColumn => {
      let type: ExportColumn['type'] = 'string';
      if (!field.isList && field.kind === 'scalar') {
        if (NUMERIC.has(field.type)) type = 'number';
        else if (field.type === 'Boolean') type = 'boolean';
        else if (field.type === 'DateTime') type = 'datetime';
      }
      return { key: field.name, label: labelOf(field.name), type };
    });
}

/**
 * One database value as an export cell: a date is ISO 8601, a `BigInt` a
 * number (or its text beyond 2^53), a `Decimal` a number, JSON and lists
 * their JSON text.
 *
 * @param value - what the client returned.
 * @param column - the column it belongs to.
 * @returns the cell.
 *
 * @stability experimental
 */
export function toExportCell(value: unknown, column: ExportColumn): ExportCell {
  if (value === null || value === undefined) return null;
  if (isDate(value)) return value.toISOString();
  if (typeof value === 'bigint') {
    return value <= BigInt(Number.MAX_SAFE_INTEGER) && value >= BigInt(Number.MIN_SAFE_INTEGER) ? Number(value) : value.toString();
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return column.type === 'string' ? String(value) : value;
  }
  if (typeof value === 'string') return value;
  if (column.type === 'number' && typeof (value as { toString?: unknown }).toString === 'function') {
    const n = Number(String(value));
    return Number.isFinite(n) ? n : String(value);
  }
  return JSON.stringify(value);
}

/**
 * Whether `value` is a `Date`, from any realm (a test sandbox, a worker).
 *
 * @param value - anything.
 * @returns `true` for a date.
 *
 * @stability experimental
 */
export function isDate(value: unknown): value is Date {
  return Object.prototype.toString.call(value) === '[object Date]';
}

/**
 * `PersonalAccessToken` → `personalAccessToken`: the client's delegate name.
 *
 * @param model - the model name.
 * @returns the delegate key on a Prisma client.
 *
 * @stability experimental
 */
export function delegateNameOf(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}
