// =============================================================================
// The `json` export writer: one versioned document (issue #744; EvoPath
// `writers/json.writer.ts`, H7 #191)
// =============================================================================
//
// `{ schemaVersion: 1, source, exportedAt, datasets: { <dataset>: { title,
// columns, rows: [...] } } }` (`exportJsonFileSchema` in the contract),
// streamed one row at a time with backpressure, so a long history is never
// one big string. Datasets appear in the order the source yields them.
// =============================================================================

import { EXPORT_DATASET_PATTERN, EXPORT_JSON_SCHEMA_VERSION } from '@marinoscar/platform-contract/exports';

import { endStream, failStream, writeChunk } from '../export-stream';
import type { ExportWriter } from '../export.types';

/**
 * The built-in JSON writer (`application/json`, `.json`).
 *
 * @stability experimental
 */
export const JSON_EXPORT_WRITER: ExportWriter = {
  id: 'json',
  label: 'JSON',
  mimeType: 'application/json',
  extension: 'json',
  async write(tables, out, ctx) {
    const rowCounts: Record<string, number> = {};
    try {
      const head = { schemaVersion: EXPORT_JSON_SCHEMA_VERSION, source: ctx.source, exportedAt: ctx.exportedAt.toISOString() };
      // The head object, left open so `datasets` can stream after it.
      await writeChunk(out, JSON.stringify(head).slice(0, -1) + ',"datasets":{');
      let first = true;
      for await (const table of tables) {
        assertDataset(table.dataset, rowCounts);
        const meta = JSON.stringify({ title: table.title, columns: table.columns });
        await writeChunk(out, `${first ? '' : ','}${JSON.stringify(table.dataset)}:${meta.slice(0, -1)},"rows":[`);
        first = false;
        let count = 0;
        for await (const row of table.rows) {
          const record: Record<string, unknown> = {};
          for (const column of table.columns) record[column.key] = row[column.key] ?? null;
          await writeChunk(out, (count > 0 ? ',' : '') + JSON.stringify(record));
          count += 1;
        }
        rowCounts[table.dataset] = count;
        await writeChunk(out, ']}');
      }
      await writeChunk(out, '}}\n');
      await endStream(out);
      return { rowCounts };
    } catch (error) {
      throw failStream(out, error);
    }
  },
};

/**
 * Throws when a dataset name is malformed or repeated within one export.
 *
 * @param dataset - the dataset name.
 * @param seen - the names written so far.
 *
 * @stability experimental
 */
export function assertDataset(dataset: string, seen: Readonly<Record<string, number>>): void {
  if (!EXPORT_DATASET_PATTERN.test(dataset)) {
    throw new Error(`Export dataset ${JSON.stringify(dataset)} must match ${EXPORT_DATASET_PATTERN}`);
  }
  if (dataset in seen) throw new Error(`Export dataset "${dataset}" appears twice`);
}
