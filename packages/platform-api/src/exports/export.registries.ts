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

import { EXPORT_ID_PATTERN } from '@marinoscar/platform-contract/exports';

import { defineRegistry, type Registry } from '../core/index';
import type { ExportSource, ExportWriter } from './export.types';

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
  if (!Array.isArray(source.formats) || source.formats.length === 0) throw new Error('formats must name at least one writer');
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
 * The writers a source may use: those it lists, that are registered and that
 * do not limit themselves to other sources, in the source's order.
 *
 * @param source - the source.
 * @returns the writers.
 *
 * @stability experimental
 */
export function writersFor(source: ExportSource): ExportWriter[] {
  return source.formats
    .map((format) => exportWriterRegistry.get(format))
    .filter((writer): writer is ExportWriter => writer !== undefined)
    .filter((writer) => writer.sources === undefined || writer.sources.includes(source.id));
}
