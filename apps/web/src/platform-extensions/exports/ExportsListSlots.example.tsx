/**
 * Reference example (PP-14.20): an app adds a column and a per-export action to
 * the packaged exports list through `slots.Columns` and `slots.RowActions`, with
 * no package edit.
 *
 * "Rows" is the number of rows the export holds (the sum of `rowCounts`, which
 * the API already returns), drawn on the line under the title. "Copy name"
 * copies the file name to the clipboard. Both read only the export the list
 * already holds; neither calls the API.
 *
 * Wire it where the list is rendered:
 * `<ExportsList exports={exports} sources={sources} slots={exportsListSlots} />`.
 * The reference app does not wire it: it ships compiled and tested, like the
 * other web examples.
 */
import { Button } from '@mui/material';
import type { ExportView } from '@marinoscar/platform-contract/exports';
import type { ExportsListColumn, ExportsListSlots } from '@marinoscar/platform-web/exports/ui';

/** Total rows across the datasets of an export, or `null` while it has none recorded. */
export function totalRows(view: Pick<ExportView, 'rowCounts'>): number | null {
  if (!view.rowCounts) return null;
  return Object.values(view.rowCounts).reduce((sum, count) => sum + count, 0);
}

const ROWS_COLUMN: ExportsListColumn = {
  id: 'rows',
  label: 'Rows',
  priority: 'secondary',
  render: (view) => {
    const rows = totalRows(view);
    return rows === null ? null : `${rows.toLocaleString()} rows`;
  },
};

/** The slots: the "Rows" column after the size, and a "Copy name" action. */
export const exportsListSlots: ExportsListSlots = {
  Columns: (base) => {
    const at = base.findIndex((column) => column.id === 'size');
    return at === -1 ? [...base, ROWS_COLUMN] : [...base.slice(0, at + 1), ROWS_COLUMN, ...base.slice(at + 1)];
  },
  RowActions: ({ row }) =>
    row.fileName ? (
      <Button size="small" onClick={() => void navigator.clipboard?.writeText(row.fileName ?? '')} sx={{ minHeight: 44 }}>
        Copy name
      </Button>
    ) : null,
};
