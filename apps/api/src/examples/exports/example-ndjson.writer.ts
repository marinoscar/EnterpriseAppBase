// =============================================================================
// Reference example: a writer attached to every source (PP-14.20)
// =============================================================================
//
// `ndjson`: newline-delimited JSON, one line per dataset header and one per
// row. It shows the two seams a new FORMAT needs and a new SOURCE does not:
//
//   - `attachTo: '*'`: the writer lists itself on every source whose columns
//     it can write, instead of each source (the platform's `user-data` and
//     `org-data` included) listing it in `formats`. The platform sources list
//     nothing: their formats are the writers attached to them, json, csv and
//     xlsx first and this one after.
//   - `ExportColumn.meta`: writer-specific typing a source MAY put on a column
//     (here a `logicalType` hint); the header line carries it, the built-in
//     writers ignore it.
//
// The writer sees the rows its source produced and nothing else: the
// platform sources redact secrets, hashes and hints before any writer runs, so
// this writer cannot leak what a built-in one cannot. `exports.secret-egress`
// runs `user-data` and `org-data` through EVERY writer offered on them, this
// one included (`test/exports/exports-conformance.spec.ts`).
//
// Registered by `platform/exports/export-registrations.manifest.ts`; a fork
// deletes the line with `examples/`.
// =============================================================================

import { endStream, failStream, writeChunk, type ExportWriter } from '@marinoscar/platform-api/exports';

/** The `ndjson` writer. Attached to `'*'`; writes every column type. */
export const EXAMPLE_NDJSON_WRITER: ExportWriter = {
  id: 'ndjson',
  label: 'NDJSON',
  mimeType: 'application/x-ndjson',
  extension: 'ndjson',
  attachTo: '*',
  async write(tables, out, ctx) {
    const rowCounts: Record<string, number> = {};
    try {
      for await (const table of tables) {
        // One header line per dataset: its title and columns, `meta` included.
        const header = { dataset: table.dataset, title: table.title, columns: table.columns };
        await writeChunk(out, `${JSON.stringify(header)}\n`);
        let count = 0;
        for await (const row of table.rows) {
          const record: Record<string, unknown> = {};
          for (const column of table.columns) record[column.key] = row[column.key] ?? null;
          await writeChunk(out, `${JSON.stringify({ dataset: table.dataset, row: record })}\n`);
          count += 1;
        }
        rowCounts[table.dataset] = count;
      }
      // A trailing footer, so a reader can tell a complete file from a cut one.
      await writeChunk(out, `${JSON.stringify({ source: ctx.source, exportedAt: ctx.exportedAt.toISOString(), rowCounts })}\n`);
      await endStream(out);
      return { rowCounts };
    } catch (error) {
      throw failStream(out, error);
    }
  },
};
