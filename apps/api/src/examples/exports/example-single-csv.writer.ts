// =============================================================================
// Reference example: a custom export writer built on the CSV helpers (#744)
// =============================================================================
//
// `csv-single`: ONE CSV file (no zip) with a leading `dataset` column, for a
// source that produces one or a few small datasets. It shows the writer
// contract (`write` streams to `out` with `writeChunk`, ENDS it with
// `endStream`, and on failure destroys it with `failStream`) and the shared
// CSV helpers (`UTF8_BOM`, `csvRecord`, `csvField`, `neutralizeFormula`,
// `csvCell`, `CSV_LINE_END`), so formula injection and RFC 4180 quoting are
// the platform's rules, not a copy. Limited to the example source with
// `sources`, the way a domain PDF writer limits itself to its domain source.
// =============================================================================

import {
  CSV_LINE_END,
  UTF8_BOM,
  csvCell,
  csvField,
  csvRecord,
  endStream,
  failStream,
  neutralizeFormula,
  writeChunk,
  type ExportWriter,
} from '@marinoscar/platform-api/exports';

export const EXAMPLE_SINGLE_CSV_WRITER: ExportWriter = {
  id: 'csv-single',
  label: 'CSV (single file)',
  mimeType: 'text/csv',
  extension: 'csv',
  sources: ['example-notification-inbox'],
  async write(tables, out) {
    const rowCounts: Record<string, number> = {};
    try {
      let first = true;
      for await (const table of tables) {
        const header = ['dataset', ...table.columns.map((column) => column.key)].map((key) => csvField(neutralizeFormula(key)));
        await writeChunk(out, (first ? UTF8_BOM : CSV_LINE_END) + csvRecord(header) + CSV_LINE_END);
        first = false;
        let count = 0;
        for await (const row of table.rows) {
          const cells = table.columns.map((column) => csvCell(row[column.key] ?? null, column.type === 'number'));
          await writeChunk(out, csvRecord([csvField(table.dataset), ...cells]) + CSV_LINE_END);
          count += 1;
        }
        rowCounts[table.dataset] = count;
      }
      await endStream(out);
      return { rowCounts };
    } catch (error) {
      throw failStream(out, error);
    }
  },
};
