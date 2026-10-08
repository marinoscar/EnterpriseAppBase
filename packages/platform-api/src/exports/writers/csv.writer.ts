// =============================================================================
// The `csv` export writer: a zip of one CSV per dataset (issue #744; EvoPath
// `writers/csv.writer.ts`, H7 #191)
// =============================================================================
//
// `<dataset>.csv` per dataset, each RFC 4180 with a CRLF after every record, a
// header row of column keys and a UTF-8 BOM, through the shared CSV helpers.
// Text cells a spreadsheet would read as a formula are neutralised; numeric
// columns are left alone. The zip streams (archiver): one entry at a time, the
// next table is not pulled until the previous entry was written, and nothing
// is buffered whole.
// =============================================================================

import { once } from 'node:events';
import { Readable } from 'node:stream';

import archiver from 'archiver';

import { CSV_LINE_END, UTF8_BOM, csvCell, csvField, csvRecord, neutralizeFormula } from '../csv';
import { failStream } from '../export-stream';
import type { ExportTable, ExportWriter } from '../export.types';
import { assertDataset } from './json.writer';

/**
 * One dataset's CSV lines (header first, BOM on the header), produced as the
 * rows arrive; `onRow` counts them.
 *
 * @param table - the dataset.
 * @param onRow - called once per data row.
 * @returns the lines, each ending in CRLF.
 *
 * @stability experimental
 */
export async function* csvLines(table: ExportTable, onRow: () => void = () => undefined): AsyncGenerator<string> {
  yield UTF8_BOM + csvRecord(table.columns.map((column) => csvField(neutralizeFormula(column.key)))) + CSV_LINE_END;
  for await (const row of table.rows) {
    onRow();
    yield csvRecord(table.columns.map((column) => csvCell(row[column.key] ?? null, column.type === 'number'))) + CSV_LINE_END;
  }
}

/**
 * The built-in CSV writer: a zip of per-dataset CSVs (`application/zip`,
 * `.zip`).
 *
 * @stability experimental
 */
export const CSV_EXPORT_WRITER: ExportWriter = {
  id: 'csv',
  label: 'CSV (zip)',
  mimeType: 'application/zip',
  extension: 'zip',
  async write(tables, out, ctx) {
    const rowCounts: Record<string, number> = {};
    const archive = archiver('zip', { zlib: { level: 6 } });
    const finished = new Promise<void>((resolve, reject) => {
      out.once('finish', resolve);
      out.on('error', reject);
      out.once('close', () => {
        if (!out.writableFinished) reject(out.errored ?? new Error('The export stream was closed'));
      });
      archive.on('error', reject);
      archive.on('warning', reject);
    });
    // A rejection is surfaced by the awaits below; never leave it unhandled.
    finished.catch(() => undefined);
    archive.pipe(out);

    try {
      for await (const table of tables) {
        assertDataset(table.dataset, rowCounts);
        rowCounts[table.dataset] = 0;
        const entry = once(archive, 'entry');
        archive.append(
          Readable.from(
            csvLines(table, () => {
              rowCounts[table.dataset] = (rowCounts[table.dataset] ?? 0) + 1;
            }),
          ),
          { name: `${table.dataset}.csv`, date: ctx.exportedAt },
        );
        // One entry at a time: the source's next table is pulled only once
        // this one's rows were all read and compressed.
        await Promise.race([entry, finished]);
      }
      await archive.finalize();
      await finished;
      return { rowCounts };
    } catch (error) {
      archive.abort();
      throw failStream(out, error);
    }
  },
};
