// The exports slice's reference examples (#744), driven the way the slice
// drives them: the example source through the registry and a writer, the
// example writer through the platform's writer contract, the document
// exporter through its registry.
import { Writable } from 'node:stream';

import {
  exportSourceRegistry,
  exportWriterRegistry,
  requestFieldsOf,
  writersFor,
  type ExportContext,
} from '@marinoscar/platform-api/exports';
import { collectExportOutput, tablesOf } from '@marinoscar/platform-api/exports/testing';
import { Prisma } from '@prisma/client';

import '../../platform/exports/exports.config';
import {
  EXAMPLE_MARKDOWN_EXPORTER,
  ExampleDigestExporterRegistry,
  exampleDigestRenderKey,
} from './example-markdown.exporter';
import { EXAMPLE_NOTIFICATION_INBOX_SOURCE } from './example-notification-inbox.source';
import { EXAMPLE_SINGLE_CSV_WRITER } from './example-single-csv.writer';

const USER = '11111111-1111-4111-8111-111111111111';

function ctx(rows: Array<Record<string, unknown>>, queries: unknown[] = []): ExportContext {
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
  };
}

describe('exports reference examples', () => {
  it('registers the example source and its writer, and offers the writer only to it', () => {
    expect(exportSourceRegistry.get('example-notification-inbox')).toBe(EXAMPLE_NOTIFICATION_INBOX_SOURCE);
    expect(exportWriterRegistry.get('csv-single')).toBe(EXAMPLE_SINGLE_CSV_WRITER);
    expect(writersFor(EXAMPLE_NOTIFICATION_INBOX_SOURCE).map((w) => w.id)).toEqual(['csv-single', 'json', 'csv', 'xlsx']);
    expect(writersFor(exportSourceRegistry.require('user-data')).map((w) => w.id)).toEqual(['json', 'csv', 'xlsx']);
  });

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
