// The exports slice's reference examples (#744), driven the way the slice
// drives them: the example source through the registry and a writer, the
// example writer through the platform's writer contract, the document
// exporter through its registry.
import { Writable } from 'node:stream';

import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import {
  USER_DATA_EXPORT_SOURCE,
  exportSourceRegistry,
  exportWriterRegistry,
  registerExportSource,
  requestFieldsOf,
  writersFor,
  type ExportContext,
  type ExportWriter,
} from '@marinoscar/platform-api/exports';
import { collectExportOutput, tablesOf } from '@marinoscar/platform-api/exports/testing';
import { Prisma } from '@prisma/client';

import '../../platform/exports/exports.config';
import {
  EXAMPLE_MARKDOWN_EXPORTER,
  ExampleDigestExporterRegistry,
  exampleDigestRenderKey,
} from './example-markdown.exporter';
import { EXAMPLE_NDJSON_WRITER } from './example-ndjson.writer';
import { EXAMPLE_NOTIFICATION_INBOX_SOURCE } from './example-notification-inbox.source';
import { EXAMPLE_SINGLE_CSV_WRITER } from './example-single-csv.writer';

const USER = '11111111-1111-4111-8111-111111111111';

function ctx(rows: Array<Record<string, unknown>>, queries: unknown[] = [], timeZone = 'UTC'): ExportContext {
  return {
    exportId: 'e',
    scope: 'user',
    subjectId: USER,
    requestedById: USER,
    db: {
      notification: {
        findMany: async (args: { where: unknown; take: number }) => {
          queries.push(args.where);
          return queries.length === 1 ? rows : [];
        },
      },
    },
    datamodel: Prisma.dmmf.datamodel,
    pageSize: 50,
    now: new Date('2026-10-08T00:00:00.000Z'),
    timeZone,
  };
}

describe('exports reference examples', () => {
  it('registers the example source and its writer, and offers the writer only to it', () => {
    expect(exportSourceRegistry.get('example-notification-inbox')).toBe(EXAMPLE_NOTIFICATION_INBOX_SOURCE);
    expect(exportWriterRegistry.get('csv-single')).toBe(EXAMPLE_SINGLE_CSV_WRITER);
    // The listed formats come first; the writer attached to '*' follows them.
    expect(writersFor(EXAMPLE_NOTIFICATION_INBOX_SOURCE).map((w) => w.id)).toEqual(['csv-single', 'json', 'csv', 'xlsx', 'ndjson']);
    // The platform sources list no format: their formats are the writers attached to them.
    expect(exportSourceRegistry.require('user-data').formats).toEqual([]);
    expect(writersFor(exportSourceRegistry.require('user-data')).map((w) => w.id)).toEqual(['json', 'csv', 'xlsx', 'ndjson']);
    expect(writersFor(exportSourceRegistry.require('org-data')).map((w) => w.id)).toEqual(['json', 'csv', 'xlsx', 'ndjson']);
  });

  it('the ndjson writer is attached to every source and writes the rows its source produced', async () => {
    expect(exportWriterRegistry.get('ndjson')).toBe(EXAMPLE_NDJSON_WRITER);
    expect(EXAMPLE_NDJSON_WRITER.attachTo).toBe('*');
    const { bytes, result } = await collectExportOutput(
      EXAMPLE_NDJSON_WRITER,
      tablesOf([
        {
          dataset: 'notes',
          title: 'Notes',
          columns: [
            { key: 'id', label: 'Id', type: 'string' },
            { key: 'amount', label: 'Amount', type: 'number', meta: { logicalType: 'DECIMAL(10,2)' } },
          ],
          rows: [{ id: 'a', amount: 1.5 }, { id: 'b' }],
        },
      ]),
      'user-data',
    );
    expect(result.rowCounts).toEqual({ notes: 2 });
    const lines = bytes.toString('utf8').trimEnd().split('\n').map((line) => JSON.parse(line));
    expect(lines[0]).toMatchObject({ dataset: 'notes', columns: [{ key: 'id' }, { key: 'amount', meta: { logicalType: 'DECIMAL(10,2)' } }] });
    expect(lines[1]).toEqual({ dataset: 'notes', row: { id: 'a', amount: 1.5 } });
    expect(lines[2]).toEqual({ dataset: 'notes', row: { id: 'b', amount: null } });
    expect(lines[3]).toMatchObject({ source: 'user-data', rowCounts: { notes: 2 } });
  });

  it('a writer restricted with columnTypes attaches under * only to sources that declare columns it can write', () => {
    const scalars: ExportWriter = {
      id: 'scalars',
      label: 'Scalars',
      mimeType: 'text/plain',
      extension: 'txt',
      attachTo: '*',
      columnTypes: ['string', 'number'],
      write: async () => ({ rowCounts: {} }),
    };
    return withTemporaryEntries(exportWriterRegistry, [scalars], () => {
      const declared = { ...USER_DATA_EXPORT_SOURCE, id: 'plain-source', formats: [], columnTypes: ['string', 'number'] as const };
      const undeclared = { ...USER_DATA_EXPORT_SOURCE, id: 'unknown-source', formats: [], columnTypes: undefined };
      expect(writersFor(declared).map((w) => w.id)).toEqual(['ndjson', 'scalars']);
      // A source that does not say what its columns are is assumed to use every type.
      expect(writersFor(undeclared).map((w) => w.id)).toEqual(['ndjson']);
      // The platform sources declare datetime and boolean columns too.
      expect(writersFor(USER_DATA_EXPORT_SOURCE).map((w) => w.id)).not.toContain('scalars');
    });
  });

  it('a source spread from a platform one and registered under its own id lists its formats; attached writers still follow', () =>
    withTemporaryEntries(exportSourceRegistry, [], () => {
      // The platform writers attach to `user-data` and `org-data` only, so a source
      // under another id lists the ones it wants; the '*' writer (ndjson) follows.
      const custom = { ...USER_DATA_EXPORT_SOURCE, id: 'user-data-v2', label: 'Your account data', formats: ['json', 'csv'] };
      registerExportSource(custom);
      expect(writersFor(custom).map((w) => w.id)).toEqual(['json', 'csv', 'ndjson']);
      // ... and can pin its formats: listed ones only, attached writers refused.
      const pinned = { ...custom, id: 'user-data-pinned', acceptsAttachedWriters: false };
      registerExportSource(pinned);
      expect(writersFor(pinned).map((w) => w.id)).toEqual(['json', 'csv']);
    }));

  it('the source: a strict request with a range check, dialog fields derived from it, an owner filter on every page', async () => {
    const schema = EXAMPLE_NOTIFICATION_INBOX_SOURCE.requestSchema;
    expect(schema.safeParse({ from: '2026-10-01', to: '2026-09-01' }).success).toBe(false);
    expect(schema.safeParse({ extra: 1 }).success).toBe(false);
    expect(requestFieldsOf(schema).map((f) => `${f.key}:${f.kind}:${f.required}`)).toEqual([
      'from:date:false',
      'to:date:false',
      'unreadOnly:boolean:false',
    ]);

    const queries: unknown[] = [];
    const request = schema.parse({ from: '2026-10-01', unreadOnly: true });
    const rows = [{ id: 'n1', eventKey: 'user.welcome', title: '=cmd', body: 'Hi', readAt: null, createdAt: new Date('2026-10-02T00:00:00.000Z') }];
    const { bytes, result } = await collectExportOutput(
      EXAMPLE_SINGLE_CSV_WRITER,
      EXAMPLE_NOTIFICATION_INBOX_SOURCE.collect(ctx(rows, queries), request),
      'example-notification-inbox',
    );
    expect(queries[0]).toEqual({ userId: USER, createdAt: { gte: new Date('2026-10-01T00:00:00.000Z') }, readAt: null });
    expect(result.rowCounts).toEqual({ notifications: 1 });
    expect(bytes.toString('utf8')).toBe(
      '﻿dataset,id,event,title,body,read_at,created_at\r\nnotifications,n1,user.welcome,\'=cmd,Hi,,2026-10-02T00:00:00.000Z\r\n',
    );
    expect(EXAMPLE_NOTIFICATION_INBOX_SOURCE.fileName!(ctx([]), request, 'csv')).toBe('notification-inbox-2026-10-01-2026-10-08.csv');
  });

  it("reads the from/to days in the requester's zone: local midnights, and the file name's default end day is the zone's", async () => {
    const queries: unknown[] = [];
    const request = EXAMPLE_NOTIFICATION_INBOX_SOURCE.requestSchema.parse({ from: '2026-10-01', to: '2026-10-03' });
    await collectExportOutput(
      EXAMPLE_SINGLE_CSV_WRITER,
      EXAMPLE_NOTIFICATION_INBOX_SOURCE.collect(ctx([], queries, 'America/Costa_Rica'), request),
      'example-notification-inbox',
    );
    // Costa Rica is UTC-6: local midnight of Oct 1 is 06:00Z, and the day after Oct 3 starts 2026-10-04T06:00Z.
    expect(queries[0]).toMatchObject({
      userId: USER,
      createdAt: { gte: new Date('2026-10-01T06:00:00.000Z'), lt: new Date('2026-10-04T06:00:00.000Z') },
    });
    // 2026-10-08T00:00Z is still Oct 7 in Costa Rica.
    const open = EXAMPLE_NOTIFICATION_INBOX_SOURCE.requestSchema.parse({ from: '2026-10-01' });
    expect(EXAMPLE_NOTIFICATION_INBOX_SOURCE.fileName!(ctx([], [], 'America/Costa_Rica'), open, 'csv')).toBe('notification-inbox-2026-10-01-2026-10-07.csv');
  });

  it('the writer ends its output and reports the rows of every dataset', async () => {
    const { bytes, result } = await collectExportOutput(
      EXAMPLE_SINGLE_CSV_WRITER,
      tablesOf([
        { dataset: 'a', title: 'A', columns: [{ key: 'n', label: 'N', type: 'number' }], rows: [{ n: -1 }] },
        { dataset: 'b', title: 'B', columns: [{ key: 's', label: 'S', type: 'string' }], rows: [{ s: '-1' }, { s: 'x,y' }] },
      ]),
    );
    expect(result.rowCounts).toEqual({ a: 1, b: 2 });
    expect(bytes.toString('utf8')).toBe('﻿dataset,n\r\na,-1\r\n\r\ndataset,s\r\nb,\'-1\r\nb,"x,y"\r\n');
  });

  it('the document exporter: a registry per document type, options from one declaration, a streamed render', async () => {
    const registry = new ExampleDigestExporterRegistry();
    registry.register(EXAMPLE_MARKDOWN_EXPORTER);
    expect(registry.formats()).toEqual(['markdown']);

    const options = EXAMPLE_MARKDOWN_EXPORTER.optionsSchema.parse({});
    expect(options).toEqual({ includeTimestamps: true });
    expect(EXAMPLE_MARKDOWN_EXPORTER.optionsSchema.safeParse({ includeTimestamp: true }).success).toBe(false);

    const chunks: string[] = [];
    const out = new Writable({ write: (chunk, _enc, cb) => (chunks.push(String(chunk)), cb()) });
    const doc = { title: 'Digest', version: 3, items: [{ at: new Date('2026-10-08T00:00:00.000Z'), text: 'hello' }] };
    await registry.get('markdown')!.render(doc, { includeTimestamps: false }, out);
    expect(chunks.join('')).toBe('# Digest\n\n- hello\n');
    expect(out.writableFinished).toBe(true);
    expect(exampleDigestRenderKey(doc, {})).not.toBe(exampleDigestRenderKey({ ...doc, version: 4 }, {}));
    expect(exampleDigestRenderKey(doc, { includeTimestamps: true })).toBe(exampleDigestRenderKey(doc, options));
  });
});
