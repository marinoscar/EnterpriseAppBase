// =============================================================================
// The export source and writer registries (issue #744)
// =============================================================================
//
// Two static registries on the core primitive, filled before bootstrap and
// frozen with every other `defineRegistry` registry:
//
//   - sources: `user-data` and `org-data` (the platform's, registered by
//     `ExportsModule.forRoot()`), then each app's own (EvoPath's `health`,
//     kvox's `transcript`);
//   - writers: `json`, `csv` and `xlsx` (the platform's), then each app's own
//     (a domain PDF limited to its source with `sources`).
//
// IDS ARE PERMANENT once jobs carry them (a job's payload names the source
// and the format): the job type rule applies.
//
// Re-registering the SAME object is a no-op, so `forRoot()` may run after an
// app's manifest already registered the built-ins; a different entry under a
// registered id is `DUPLICATE_ID`.
// =============================================================================

import { EXPORT_COLUMN_TYPES, EXPORT_ID_PATTERN } from '@marinoscar/platform-contract/exports';

import { defineRegistry, type Registry } from '../core/index';
import type { ExportColumnType, ExportSource, ExportTable, ExportWriter } from './export.types';

/**
 * The platform writers, in the order they are offered first when several
 * writers attach to a source. An app's writer attaches after them, so the
 * dialog's default format does not change when an app adds one.
 */
const PLATFORM_WRITER_ORDER: readonly string[] = ['json', 'csv', 'xlsx'];

function checkColumnTypes(types: readonly ExportColumnType[] | undefined, field: string): void {
  if (types === undefined) return;
  if (!Array.isArray(types) || types.length === 0) throw new Error(`${field}, when given, must name at least one column type`);
  for (const type of types) {
    if (!(EXPORT_COLUMN_TYPES as readonly string[]).includes(type)) {
      throw new Error(`${field} names unknown column type ${JSON.stringify(type)}; one of ${EXPORT_COLUMN_TYPES.join(', ')}`);
    }
  }
}

function validateSource(source: ExportSource): void {
  if (source.scope !== 'user' && source.scope !== 'org') {
    throw new Error(`scope must be 'user' or 'org', not ${JSON.stringify(source.scope)}`);
  }
  if (typeof source.label !== 'string' || source.label.trim() === '') throw new Error('label is required');
  if (typeof source.permission !== 'string' || source.permission.trim() === '') {
    throw new Error('permission is required: the exact string the route enforces');
  }
  if (source.crossOrgPermission !== undefined && source.scope !== 'org') {
    throw new Error("crossOrgPermission is only for 'org' sources");
  }
  // An empty list is valid: the platform sources list none and offer the
  // writers that attach to them. `exports` conformance flags a source that
  // ends up with no writer at all.
  if (!Array.isArray(source.formats)) throw new Error('formats must be an array of writer ids (it may be empty when writers attach)');
  for (const format of source.formats) {
    if (typeof format !== 'string' || !EXPORT_ID_PATTERN.test(format)) {
      throw new Error(`format ${JSON.stringify(format)} must match ${EXPORT_ID_PATTERN}`);
    }
  }
  if (new Set(source.formats).size !== source.formats.length) throw new Error('formats must not repeat a writer');
  if (!source.requestSchema || typeof (source.requestSchema as { safeParse?: unknown }).safeParse !== 'function') {
    throw new Error('requestSchema must be a zod schema');
  }
  if (typeof source.collect !== 'function') throw new Error('collect must be a function');
  checkColumnTypes(source.columnTypes, 'columnTypes');
  if (source.acceptsAttachedWriters !== undefined && typeof source.acceptsAttachedWriters !== 'boolean') {
    throw new Error('acceptsAttachedWriters must be a boolean');
  }
}

function validateWriter(writer: ExportWriter): void {
  if (typeof writer.label !== 'string' || writer.label.trim() === '') throw new Error('label is required');
  if (typeof writer.mimeType !== 'string' || !/^[a-z]+\/[a-z0-9.+-]+$/i.test(writer.mimeType)) {
    throw new Error(`mimeType ${JSON.stringify(writer.mimeType)} must be a media type`);
  }
  if (typeof writer.extension !== 'string' || !/^[a-z0-9]{1,8}$/.test(writer.extension)) {
    throw new Error('extension must be 1 to 8 lowercase letters or digits, without the dot');
  }
  if (writer.sources !== undefined && (!Array.isArray(writer.sources) || writer.sources.length === 0)) {
    throw new Error('sources, when given, must name at least one source');
  }
  if (typeof writer.write !== 'function') throw new Error('write must be a function');
  checkColumnTypes(writer.columnTypes, 'columnTypes');
  if (writer.attachTo !== undefined && writer.attachTo !== '*') {
    if (!Array.isArray(writer.attachTo) || writer.attachTo.length === 0) {
      throw new Error("attachTo, when given, must be '*' or name at least one source");
    }
    for (const id of writer.attachTo) {
      if (typeof id !== 'string' || !EXPORT_ID_PATTERN.test(id)) throw new Error(`attachTo ${JSON.stringify(id)} must match ${EXPORT_ID_PATTERN}`);
    }
  }
}

/**
 * Every registered export source, in registration order.
 *
 * @stability experimental
 */
export const exportSourceRegistry: Registry<ExportSource> = defineRegistry<ExportSource>({
  name: 'export-sources',
  idOf: (source) => source.id,
  idPattern: EXPORT_ID_PATTERN,
  validate: (source) => validateSource(source),
});

/**
 * Every registered export writer, in registration order.
 *
 * @stability experimental
 */
export const exportWriterRegistry: Registry<ExportWriter> = defineRegistry<ExportWriter>({
  name: 'export-writers',
  idOf: (writer) => writer.id,
  idPattern: EXPORT_ID_PATTERN,
  validate: (writer) => validateWriter(writer),
});

/**
 * Registers an export source (rung 2). Re-registering the same object is a
 * no-op.
 *
 * @param source - the source.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerExportSource(EXAMPLE_NOTIFICATION_INBOX_SOURCE);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerExportSource<Req>(source: ExportSource<Req>): void {
  if (exportSourceRegistry.get(source.id) === (source as ExportSource)) return;
  exportSourceRegistry.register(source as ExportSource);
}

/**
 * Registers an export writer (rung 2). Re-registering the same object is a
 * no-op.
 *
 * @param writer - the writer.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```ts
 * registerExportWriter(EXAMPLE_SINGLE_CSV_WRITER);
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerExportWriter(writer: ExportWriter): void {
  if (exportWriterRegistry.get(writer.id) === writer) return;
  exportWriterRegistry.register(writer);
}

/**
 * Whether `writer` can write every column type a source may use. A source that
 * declares no `columnTypes` may use any, so only a writer with no restriction
 * qualifies.
 *
 * @param writer - the writer.
 * @param source - the source.
 * @returns `true` when the writer supports the source's columns.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function writerSupportsSource(writer: ExportWriter, source: ExportSource): boolean {
  if (writer.columnTypes === undefined) return true;
  const used: readonly ExportColumnType[] = source.columnTypes ?? EXPORT_COLUMN_TYPES;
  return used.every((type) => writer.columnTypes!.includes(type));
}

function attachesTo(writer: ExportWriter, source: ExportSource): boolean {
  if (writer.attachTo === undefined) return false;
  if (writer.sources !== undefined && !writer.sources.includes(source.id)) return false;
  if (writer.attachTo === '*') return writerSupportsSource(writer, source);
  return writer.attachTo.includes(source.id);
}

/**
 * The writers a source may use: those it lists, that are registered and that
 * do not limit themselves to other sources, in the source's order; then, unless
 * the source sets `acceptsAttachedWriters: false`, the registered writers that
 * attach to it (`attachTo`): the platform writers first (json, csv, xlsx), then
 * the app's in registration order.
 *
 * @param source - the source.
 * @returns the writers.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function writersFor(source: ExportSource): ExportWriter[] {
  const listed = source.formats
    .map((format) => exportWriterRegistry.get(format))
    .filter((writer): writer is ExportWriter => writer !== undefined)
    .filter((writer) => writer.sources === undefined || writer.sources.includes(source.id));
  if (source.acceptsAttachedWriters === false) return listed;

  const have = new Set(listed.map((writer) => writer.id));
  const rank = (writer: ExportWriter): number => {
    const platform = PLATFORM_WRITER_ORDER.indexOf(writer.id);
    return platform === -1 ? PLATFORM_WRITER_ORDER.length : platform;
  };
  const attached = exportWriterRegistry
    .list()
    .filter((writer) => !have.has(writer.id) && attachesTo(writer, source))
    .map((writer, index) => ({ writer, index }))
    .sort((a, b) => rank(a.writer) - rank(b.writer) || a.index - b.index)
    .map(({ writer }) => writer);
  return [...listed, ...attached];
}

/**
 * Wraps a source's datasets so a writer never meets a column type it declared
 * it cannot write: the export fails with a message naming the dataset, the
 * column and the type, before any row is written. A writer with no
 * `columnTypes` is passed through untouched.
 *
 * @param tables - the source's datasets.
 * @param writer - the writer that will serialise them.
 * @returns the same datasets, checked as they arrive.
 * @throws Error naming the offending column.
 *
 * @extensionPoint hook
 * @stability experimental
 */
export function guardWriterColumns(tables: AsyncIterable<ExportTable>, writer: ExportWriter): AsyncIterable<ExportTable> {
  const supported = writer.columnTypes;
  if (supported === undefined) return tables;
  return (async function* guarded() {
    for await (const table of tables) {
      for (const column of table.columns) {
        if (!supported.includes(column.type)) {
          throw new Error(
            `Export format "${writer.id}" cannot write column "${column.key}" (${column.type}) of dataset "${table.dataset}"; it writes ${supported.join(', ')}`,
          );
        }
      }
      yield table;
    }
  })();
}
