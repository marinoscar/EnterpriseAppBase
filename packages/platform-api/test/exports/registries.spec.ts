import { z } from 'zod';

import { withTemporaryEntries } from '../../src/core/registry/testing';
import {
  CSV_EXPORT_WRITER,
  JSON_EXPORT_WRITER,
  USER_DATA_EXPORT_SOURCE,
  XLSX_EXPORT_WRITER,
  exportSourceRegistry,
  exportWriterRegistry,
  guardWriterColumns,
  registerExportSource,
  registerExportWriter,
  requestFieldsOf,
  writerSupportsSource,
  writersFor,
  type ExportSource,
  type ExportTable,
  type ExportWriter,
} from '../../src/exports';

const source = (over: Partial<ExportSource> = {}): ExportSource => ({
  id: 'notes',
  scope: 'user',
  label: 'Notes',
  permission: 'notes:read',
  requestSchema: z.object({}).strict(),
  formats: ['json'],
  collect: async function* () {},
  ...over,
});

const writer = (over: Partial<ExportWriter> = {}): ExportWriter => ({
  id: 'pdf',
  label: 'PDF',
  mimeType: 'application/pdf',
  extension: 'pdf',
  write: async () => ({ rowCounts: {} }),
  ...over,
});

describe('export registries', () => {
  it('validates sources', async () => {
    await withTemporaryEntries(exportSourceRegistry, [], () => {
      expect(() => registerExportSource(source({ id: 'Bad Id' }))).toThrow(/INVALID_ID|id/);
      expect(() => registerExportSource(source({ permission: '' }))).toThrow(/permission is required/);
      // An empty list is valid: writers attach (the platform sources list none).
      expect(() => registerExportSource(source({ id: 'attached-only', formats: [] }))).not.toThrow();
      expect(() => registerExportSource(source({ id: 'bad-formats', formats: 'json' as never }))).toThrow(/array of writer ids/);
      expect(() => registerExportSource(source({ id: 'bad-types', columnTypes: ['blob' as never] }))).toThrow(/unknown column type/);
      expect(() => registerExportSource(source({ id: 'bad-types2', columnTypes: [] }))).toThrow(/at least one column type/);
      expect(() => registerExportSource(source({ id: 'bad-flag', acceptsAttachedWriters: 'no' as never }))).toThrow(/boolean/);
      expect(() => registerExportSource(source({ formats: ['json', 'json'] }))).toThrow(/repeat/);
      expect(() => registerExportSource(source({ crossOrgPermission: 'x:read' }))).toThrow(/only for 'org'/);
      expect(() => registerExportSource(source({ scope: 'team' as never }))).toThrow(/scope/);
    });
  });

  it('validates writers', async () => {
    await withTemporaryEntries(exportWriterRegistry, [], () => {
      expect(() => registerExportWriter(writer({ extension: '.pdf' }))).toThrow(/extension/);
      expect(() => registerExportWriter(writer({ mimeType: 'pdf' }))).toThrow(/media type/);
      expect(() => registerExportWriter(writer({ sources: [] }))).toThrow(/at least one source/);
      expect(() => registerExportWriter(writer({ attachTo: [] }))).toThrow(/'\*' or name at least one source/);
      expect(() => registerExportWriter(writer({ attachTo: ['Bad Id'] }))).toThrow(/attachTo/);
      expect(() => registerExportWriter(writer({ attachTo: 'all' as never }))).toThrow(/'\*'/);
      expect(() => registerExportWriter(writer({ columnTypes: [] }))).toThrow(/at least one column type/);
      expect(() => registerExportWriter(writer({ columnTypes: ['uuid' as never] }))).toThrow(/unknown column type/);
    });
  });

  it('re-registering the same object is a no-op; a different one under the id is a duplicate', async () => {
    const s = source();
    await withTemporaryEntries(exportSourceRegistry, [], () => {
      registerExportSource(s);
      registerExportSource(s);
      expect(exportSourceRegistry.ids()).toEqual(['notes']);
      expect(() => registerExportSource(source())).toThrow(/Duplicate|DUPLICATE/i);
    });
  });

  it('writersFor: the source order, registered writers only, honouring a writer limited to sources', async () => {
    await withTemporaryEntries(exportWriterRegistry, [JSON_EXPORT_WRITER, writer({ sources: ['health'] })], () => {
      expect(writersFor(source({ formats: ['pdf', 'json', 'docx'] })).map((w) => w.id)).toEqual(['json']);
      expect(writersFor(source({ id: 'health', formats: ['pdf', 'json'] })).map((w) => w.id)).toEqual(['pdf', 'json']);
    });
  });
});

describe('writer attachment (attachTo)', () => {
  const ndjson = writer({ id: 'ndjson', label: 'NDJSON', mimeType: 'application/x-ndjson', extension: 'ndjson', attachTo: '*' });
  const registered = [JSON_EXPORT_WRITER, CSV_EXPORT_WRITER, XLSX_EXPORT_WRITER];

  it("'*' offers the writer on every source that does not opt out, after the listed formats", async () => {
    // Registered BEFORE the platform writers, as an app's import-time registration is.
    await withTemporaryEntries(exportWriterRegistry, [ndjson, ...registered], () => {
      expect(writersFor(source({ id: 'user-data', formats: [] })).map((w) => w.id)).toEqual(['json', 'csv', 'xlsx', 'ndjson']);
      expect(writersFor(source({ id: 'inbox', formats: ['csv'] })).map((w) => w.id)).toEqual(['csv', 'ndjson']);
      expect(writersFor(source({ id: 'inbox', formats: ['ndjson', 'csv'] })).map((w) => w.id)).toEqual(['ndjson', 'csv']);
      expect(writersFor(source({ id: 'pinned', formats: ['csv'], acceptsAttachedWriters: false })).map((w) => w.id)).toEqual(['csv']);
    });
  });

  it('the platform writers attach to user-data and org-data only, so the default formats are unchanged', async () => {
    await withTemporaryEntries(exportWriterRegistry, registered, () => {
      expect(writersFor(source({ id: 'user-data', formats: [] })).map((w) => w.id)).toEqual(['json', 'csv', 'xlsx']);
      expect(writersFor(source({ id: 'org-data', scope: 'org', formats: [] })).map((w) => w.id)).toEqual(['json', 'csv', 'xlsx']);
      expect(writersFor(source({ id: 'inbox', formats: [] }))).toEqual([]);
    });
  });

  it('replace a platform source: the same id keeps the writers attached to it, with the app\'s own fields', async () => {
    // Recipe: ExportsModule.forRoot({ platformSources: { userData: false } }), then register a spread of the platform's source.
    const ndjsonAll = writer({ id: 'ndjson', attachTo: '*' });
    await withTemporaryEntries(exportWriterRegistry, [...registered, ndjsonAll], async () => {
      await withTemporaryEntries(exportSourceRegistry, [], () => {
        const replaced: ExportSource = { ...(USER_DATA_EXPORT_SOURCE as ExportSource), label: 'Your account data', description: 'Only the account.' };
        registerExportSource(replaced);
        expect(exportSourceRegistry.require('user-data').label).toBe('Your account data');
        expect(writersFor(replaced).map((w) => w.id)).toEqual(['json', 'csv', 'xlsx', 'ndjson']);
        expect(USER_DATA_EXPORT_SOURCE.formats).toEqual([]);
      });
    });
  });

  it('a list attaches to exactly those sources, and sources narrows further', async () => {
    const some = writer({ id: 'some', attachTo: ['notes', 'other'] });
    const narrowed = writer({ id: 'narrow', attachTo: '*', sources: ['other'] });
    await withTemporaryEntries(exportWriterRegistry, [some, narrowed], () => {
      expect(writersFor(source({ id: 'notes', formats: [] })).map((w) => w.id)).toEqual(['some']);
      expect(writersFor(source({ id: 'other', formats: [] })).map((w) => w.id)).toEqual(['some', 'narrow']);
      expect(writersFor(source({ id: 'third', formats: [] })).map((w) => w.id)).toEqual([]);
    });
  });

  it("'*' attaches only to sources whose columns the writer supports", async () => {
    const scalars = writer({ id: 'scalars', attachTo: '*', columnTypes: ['string', 'number'] });
    await withTemporaryEntries(exportWriterRegistry, [scalars], () => {
      // unknown column types: every type is assumed, so a restricted writer stays off
      expect(writersFor(source({ id: 'a', formats: [] })).map((w) => w.id)).toEqual([]);
      expect(writersFor(source({ id: 'b', formats: [], columnTypes: ['string', 'number'] })).map((w) => w.id)).toEqual(['scalars']);
      expect(writersFor(source({ id: 'c', formats: [], columnTypes: ['string', 'datetime'] })).map((w) => w.id)).toEqual([]);
      // naming a source is a decision, even for a restricted writer
      const named = writer({ id: 'named', attachTo: ['a'], columnTypes: ['string'] });
      exportWriterRegistry.register(named);
      expect(writersFor(source({ id: 'a', formats: [] })).map((w) => w.id)).toEqual(['named']);
      expect(writerSupportsSource(scalars, source({ columnTypes: ['string'] }))).toBe(true);
      expect(writerSupportsSource(writer(), source())).toBe(true);
    });
  });

  it('guardWriterColumns refuses a dataset with a column type the writer cannot write, before any row', async () => {
    const scalars = writer({ id: 'scalars', attachTo: '*', columnTypes: ['string'] });
    const table = (type: 'string' | 'datetime'): ExportTable => ({
      dataset: 'things',
      title: 'Things',
      columns: [{ key: 'seen', label: 'Seen', type }],
      rows: (async function* () {
        yield { seen: 'x' };
      })(),
    });
    const drain = async (tables: AsyncIterable<ExportTable>) => {
      for await (const t of tables) void t;
    };
    await expect(drain(guardWriterColumns((async function* () { yield table('string'); })(), scalars))).resolves.toBeUndefined();
    await expect(drain(guardWriterColumns((async function* () { yield table('datetime'); })(), scalars))).rejects.toThrow(
      /format "scalars" cannot write column "seen" \(datetime\) of dataset "things"/,
    );
    const open = (async function* () { yield table('datetime'); })();
    expect(guardWriterColumns(open, writer())).toBe(open);
  });
});

describe('requestFieldsOf', () => {
  it('derives dialog fields from a request schema', () => {
    const schema = z
      .object({
        from: z.iso.date().describe('First day, inclusive'),
        to: z.iso.date().optional(),
        includeHistory: z.boolean().default(false),
        units: z.enum(['si', 'us']).default('si').meta({ title: 'Lab units' }),
        note: z.string().optional(),
        count: z.number(),
      })
      .strict();
    expect(requestFieldsOf(schema)).toEqual([
      { key: 'from', label: 'From', kind: 'date', required: true, description: 'First day, inclusive' },
      { key: 'to', label: 'To', kind: 'date', required: false },
      { key: 'includeHistory', label: 'Include history', kind: 'boolean', required: false, default: false },
      {
        key: 'units',
        label: 'Lab units',
        kind: 'select',
        required: false,
        options: [
          { value: 'si', label: 'Si' },
          { value: 'us', label: 'Us' },
        ],
        default: 'si',
      },
      { key: 'note', label: 'Note', kind: 'text', required: false },
    ]);
  });

  it('is empty for a schema without a shape', () => {
    expect(requestFieldsOf(z.string())).toEqual([]);
    expect(requestFieldsOf(z.object({}))).toEqual([]);
  });
});
