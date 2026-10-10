// =============================================================================
// One registered model as one dataset, paged (issue #744)
// =============================================================================
//
// The `user-data` and `org-data` sources export every registered model the
// same way: the columns from the datamodel (minus redaction), the rows paged
// by the model's id with the owner or organization filter, `select`ing only
// the exported columns, so a redacted value never leaves the database. A
// model without a single-field id (a composite key) is paged by offset over
// its key fields.
// =============================================================================

import type { ExportColumn } from '@marinoscar/platform-contract/exports';

import { datasetNameOf, datasetTitleOf, delegateNameOf, exportColumnsOf, toExportCell, type ExportDatamodelModel } from '../datamodel';
import type { ExportContext, ExportRow, ExportTable } from '../export.types';

/**
 * What {@link modelTable} reads.
 *
 * @stability experimental
 */
export interface ModelTableSpec {
  /** The model, from the app's datamodel. */
  readonly model: ExportDatamodelModel;
  /** The rows to export (`{ userId }`, `{ orgId }`, an `OR` of actor fields). */
  readonly where: Record<string, unknown>;
  /** Extra columns to leave out (the registry entry's `exportOmit`). */
  readonly omit?: readonly string[];
  /** The dataset name; default the model's snake_case name. */
  readonly dataset?: string;
  /** The dataset title; default from the model name. */
  readonly title?: string;
}

/**
 * The model's rows as a lazily paged dataset.
 *
 * @param ctx - the export context (its `db` and `pageSize`).
 * @param spec - the model and its filter.
 * @returns the dataset; its rows query the database only as they are read.
 * @throws Error when the client has no delegate for the model.
 *
 * @stability experimental
 */
export function modelTable(ctx: ExportContext, spec: ModelTableSpec): ExportTable {
  const columns = exportColumnsOf(spec.model, spec.omit ?? []);
  const delegate = ctx.db[delegateNameOf(spec.model.name)] as
    | { findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>> }
    | undefined;
  if (!delegate || typeof delegate.findMany !== 'function') {
    throw new Error(`The export client has no delegate for model "${spec.model.name}"`);
  }
  return {
    dataset: spec.dataset ?? datasetNameOf(spec.model.name),
    title: spec.title ?? datasetTitleOf(spec.model.name),
    columns,
    rows: pagedRows(delegate, spec, columns, ctx.pageSize),
  };
}

async function* pagedRows(
  delegate: { findMany(args: Record<string, unknown>): Promise<Array<Record<string, unknown>>> },
  spec: ModelTableSpec,
  columns: readonly ExportColumn[],
  pageSize: number,
): AsyncGenerator<ExportRow> {
  const idField =
    spec.model.fields.find((field) => field.isId)?.name ??
    spec.model.fields.find((field) => field.name === 'id' && field.kind === 'scalar')?.name;
  // No single id: page by offset over the composite key when the datamodel
  // records it, else over every orderable exported column (the key is among
  // them, so the order is total).
  const keyFields = idField
    ? [idField]
    : spec.model.primaryKey?.fields?.length
      ? [...spec.model.primaryKey.fields]
      : columns.filter((column) => isOrderable(spec.model, column.key)).map((column) => column.key);
  if (keyFields.length === 0) throw new Error(`Model "${spec.model.name}" has no id or orderable column to page by`);

  const select: Record<string, true> = {};
  for (const column of columns) select[column.key] = true;
  for (const key of keyFields) select[key] = true;
  const orderBy = keyFields.map((key) => ({ [key]: 'asc' as const }));

  let after: unknown;
  let offset = 0;
  for (;;) {
    const where = idField && after !== undefined ? { AND: [spec.where, { [idField]: { gt: after } }] } : spec.where;
    const page = await delegate.findMany({
      where,
      select,
      orderBy,
      take: pageSize,
      ...(idField ? {} : { skip: offset }),
    });
    for (const record of page) {
      const row: Record<string, ReturnType<typeof toExportCell>> = {};
      for (const column of columns) row[column.key] = toExportCell(record[column.key], column);
      yield row;
    }
    if (page.length < pageSize) return;
    if (idField) after = page[page.length - 1]![idField];
    else offset += page.length;
  }
}

/** Prisma cannot order by a JSON or a list column. */
function isOrderable(model: ModelTableSpec['model'], key: string): boolean {
  const field = model.fields.find((candidate) => candidate.name === key);
  return field !== undefined && field.type !== 'Json' && field.isList !== true;
}
