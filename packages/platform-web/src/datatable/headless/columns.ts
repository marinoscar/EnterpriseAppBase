/**
 * DataTable — column value helpers.
 *
 * The renderer-agnostic half of the column adapter: the scalar behind a cell,
 * its display text and a row's accessible name. Shared by both renderers and by
 * the CSV export, so none of them depends on DataGrid.
 */

import type { DataTableColumn } from './types.js';

/**
 * Extract the scalar behind a cell.
 *
 * Order of precedence:
 *   1. the column's explicit `value` extractor,
 *   2. `row[column.id]` when the row happens to carry that key,
 *   3. `null`.
 *
 * Non-scalar fallbacks (booleans, Dates, objects) are coerced to something
 * sortable/exportable rather than leaking a live object into the grid.
 */
export function extractColumnValue<Row>(
  column: DataTableColumn<Row>,
  row: Row,
): string | number | null {
  if (column.value) {
    return column.value(row);
  }
  const record = row as unknown as Record<string, unknown> | null | undefined;
  const raw = record == null ? undefined : record[column.id];
  if (raw === null || raw === undefined) return null;
  if (typeof raw === 'string' || typeof raw === 'number') return raw;
  if (typeof raw === 'boolean') return raw ? 'true' : 'false';
  if (raw instanceof Date) return raw.toISOString();
  return String(raw);
}

/**
 * The scalar rendered as display text (`null`/empty becomes an em dash).
 *
 * Shared with the card renderer so an empty cell reads identically in both
 * layouts — a blank card field and an em-dashed grid cell would look like two
 * different states of the data.
 */
export function formatColumnValue(value: string | number | null): string {
  return value === null || value === '' ? '—' : String(value);
}

/**
 * The accessible name for ONE row, shared by both renderers wherever a
 * control needs to disambiguate itself ("Select {row}", "Row actions for
 * {row}") — issue #257's accessibility pass.
 *
 * Derived from the first `primary` column still on screen (i.e. respecting
 * the user's #255 visibility choice, when supplied), mirroring exactly what a
 * user actually reads as "the row" in both the grid and the card headline
 * (`mobile/DataCard.tsx`'s `headlineText`). Falls back to the row id when
 * there is no primary column, or its scalar is null/empty — a bare em dash is
 * not a usable name.
 */
export function rowAccessibleName<Row>(
  columns: DataTableColumn<Row>[],
  row: Row,
  fallbackId: string,
  visibleColumnIds?: ReadonlySet<string>,
): string {
  const primary = columns.find(
    (column) =>
      column.priority === 'primary' && (!visibleColumnIds || visibleColumnIds.has(column.id)),
  );
  if (!primary) return fallbackId;
  const text = formatColumnValue(extractColumnValue(primary, row));
  return text === '—' || text === '' ? fallbackId : text;
}
