// The built-in export writers (issue #744): `json`, `csv` (a zip of CSVs) and
// `xlsx`. The platform ships no PDF writer: every PDF in the apps is domain
// layout, and an app registers its own, limited to its source.

import type { ExportWriter } from '../export.types';
import { CSV_EXPORT_WRITER } from './csv.writer';
import { JSON_EXPORT_WRITER } from './json.writer';
import { XLSX_EXPORT_WRITER } from './xlsx.writer';

export { CSV_EXPORT_WRITER, csvLines } from './csv.writer';
export { JSON_EXPORT_WRITER, assertDataset } from './json.writer';
export { XLSX_EXPORT_WRITER, xlsxSheetName } from './xlsx.writer';

/**
 * The built-in writers, in the order the dialog offers them.
 *
 * @stability experimental
 */
export const BUILTIN_EXPORT_WRITERS: readonly ExportWriter[] = Object.freeze([
  JSON_EXPORT_WRITER,
  CSV_EXPORT_WRITER,
  XLSX_EXPORT_WRITER,
]);
