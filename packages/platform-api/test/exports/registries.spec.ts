import { z } from 'zod';

import { withTemporaryEntries } from '../../src/core/registry/testing';
import {
  JSON_EXPORT_WRITER,
  exportSourceRegistry,
  exportWriterRegistry,
  registerExportSource,
  registerExportWriter,
  requestFieldsOf,
  writersFor,
  type ExportSource,
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
      expect(() => registerExportSource(source({ formats: [] }))).toThrow(/at least one writer/);
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
