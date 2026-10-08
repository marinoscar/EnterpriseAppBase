// =============================================================================
// The `xlsx` export writer: one sheet per dataset (issue #744; EvoPath
// `writers/xlsx.writer.ts`, H7 #191)
// =============================================================================
//
// One worksheet per dataset, named by its title (the characters Excel forbids
// replaced, 31 characters at most, deduplicated). Row 1 is the bold, frozen
// header of column labels. Numbers are numbers, booleans booleans, text is
// text: exceljs never writes a string cell as a formula, so there is no
// injection concern. Written with exceljs' streaming workbook writer, row by
// row, each row committed as it is added.
// =============================================================================

import { stream as excelStream } from 'exceljs';

import { failStream } from '../export-stream';
import type { ExportWriter } from '../export.types';
import { assertDataset } from './json.writer';

/** Excel's hard limit on the characters in one cell. */
const XLSX_MAX_CELL_CHARS = 32_767;

/**
 * A sheet name Excel accepts: `\ / ? * [ ] :` replaced by `-`, 31 characters
 * at most, and unique within the workbook (`Title (2)`).
 *
 * @param title - the dataset title.
 * @param taken - the names already used (lowercase); updated.
 * @returns the sheet name.
 *
 * @stability experimental
 */
export function xlsxSheetName(title: string, taken: Set<string>): string {
  const base = (title.replace(/[\\/?*[\]:]/g, '-').trim() || 'Sheet').slice(0, 31);
  let name = base;
  for (let n = 2; taken.has(name.toLowerCase()); n += 1) {
    const suffix = ` (${n})`;
    name = base.slice(0, 31 - suffix.length) + suffix;
  }
  taken.add(name.toLowerCase());
  return name;
}

/**
 * The built-in XLSX writer: one sheet per dataset
 * (`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`, `.xlsx`).
 *
 * @stability experimental
 */
export const XLSX_EXPORT_WRITER: ExportWriter = {
  id: 'xlsx',
  label: 'Excel workbook',
  mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  extension: 'xlsx',
  async write(tables, out, ctx) {
    const rowCounts: Record<string, number> = {};
    const finished = new Promise<void>((resolve, reject) => {
      out.once('finish', resolve);
      out.on('error', reject);
    });
    finished.catch(() => undefined);
    try {
      const workbook = new excelStream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
      workbook.creator = ctx.appSlug;
      workbook.created = ctx.exportedAt;
      const taken = new Set<string>();

      for await (const table of tables) {
        assertDataset(table.dataset, rowCounts);
        const sheet = workbook.addWorksheet(xlsxSheetName(table.title, taken), { views: [{ state: 'frozen', ySplit: 1 }] });
        sheet.columns = table.columns.map((column) => ({
          header: column.label,
          key: column.key,
          width: Math.min(40, Math.max(10, column.label.length + 2)),
        }));
        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).commit();

        let count = 0;
        for await (const row of table.rows) {
          const values: Record<string, string | number | boolean | null> = {};
          for (const column of table.columns) {
            const value = row[column.key] ?? null;
            values[column.key] = typeof value === 'string' ? value.slice(0, XLSX_MAX_CELL_CHARS) : value;
          }
          sheet.addRow(values).commit();
          count += 1;
          // Let the zip stream drain every so often: exceljs queues rows in
          // its worksheet stream until the event loop turns.
          if (count % 500 === 0) await new Promise<void>((resolve) => setImmediate(resolve));
        }
        rowCounts[table.dataset] = count;
        sheet.commit();
      }

      await workbook.commit();
      await finished;
      return { rowCounts };
    } catch (error) {
      throw failStream(out, error);
    }
  },
};
