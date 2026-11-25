import { randomBytes } from 'node:crypto';
import { Writable } from 'node:stream';
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';

import { CSV_EXPORT_WRITER, JSON_EXPORT_WRITER, XLSX_EXPORT_WRITER, type ExportRow, type ExportWriter } from '../../src/exports';
import { tablesOf } from '../../src/exports/testing';

// WRITERS STREAM (#744 acceptance): exporting 100k synthetic rows keeps the
// RETAINED heap (measured after a forced GC, sampled while the file flows
// into an asynchronous sink) under a fixed bound far below the file's size.
// A writer that buffered a table, or ignored backpressure, would retain the
// whole output.

setFlagsFromString('--expose-gc');
const gc = runInNewContext('gc') as () => void;

const ROWS = 100_000;
const BOUND_BYTES = 50 * 1024 * 1024;

/** Rows of (nearly incompressible) random text; samples the retained heap every 10k rows. */
function rows(padding: number, sample: () => void): AsyncGenerator<ExportRow> {
  return (async function* () {
    for (let i = 0; i < ROWS; i += 1) {
      if (i > 0 && i % 10_000 === 0) sample();
      yield { id: `row-${i}`, n: i, flag: i % 2 === 0, text: randomBytes(padding / 2).toString('hex') };
    }
  })();
}

async function measure(writer: ExportWriter, padding: number): Promise<{ bytes: number; peakRetained: number }> {
  gc();
  const baseline = process.memoryUsage().heapUsed;
  let bytes = 0;
  let peakRetained = 0;
  const sample = (): void => {
    gc();
    peakRetained = Math.max(peakRetained, process.memoryUsage().heapUsed - baseline);
  };
  const sink = new Writable({
    highWaterMark: 64 * 1024,
    write(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      // An asynchronous consumer, like an upload.
      setImmediate(callback);
    },
  });
  const tables = tablesOf([
    {
      dataset: 'synthetic',
      title: 'Synthetic',
      columns: [
        { key: 'id', label: 'Id', type: 'string' },
        { key: 'n', label: 'N', type: 'number' },
        { key: 'flag', label: 'Flag', type: 'boolean' },
        { key: 'text', label: 'Text', type: 'string' },
      ],
      rows: rows(padding, sample),
    },
  ]);
  const result = await writer.write(tables, sink, { source: 'test', exportedAt: new Date(), appSlug: 'app' });
  expect(result.rowCounts).toEqual({ synthetic: ROWS });
  return { bytes, peakRetained };
}

describe('export writers stream (100k rows)', () => {
  it('json: retained heap stays under the bound while a file larger than it flows', async () => {
    const { bytes, peakRetained } = await measure(JSON_EXPORT_WRITER, 900);
    expect(bytes).toBeGreaterThan(BOUND_BYTES * 1.5);
    expect(peakRetained).toBeLessThan(BOUND_BYTES);
  }, 120_000);

  it('csv: retained heap stays under the bound while a zip larger than it flows', async () => {
    const { bytes, peakRetained } = await measure(CSV_EXPORT_WRITER, 1200);
    expect(bytes).toBeGreaterThan(BOUND_BYTES);
    expect(peakRetained).toBeLessThan(BOUND_BYTES);
  }, 120_000);

  it('xlsx: retained heap stays under the bound', async () => {
    const { bytes, peakRetained } = await measure(XLSX_EXPORT_WRITER, 600);
    expect(bytes).toBeGreaterThan(BOUND_BYTES / 2);
    expect(peakRetained).toBeLessThan(BOUND_BYTES);
  }, 300_000);
});
