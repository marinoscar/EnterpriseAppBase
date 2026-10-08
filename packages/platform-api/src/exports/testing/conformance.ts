// =============================================================================
// The exports slice's conformance suite (issue #744)
// =============================================================================
//
// Importing `@marinoscar/platform-api/exports/testing` registers the `exports`
// suite with `runPlatformConformance()`. Checked against what the APP
// registered:
//
//   1. registry: every source's permission (and cross-organization
//      permission) is a registered permission; every source offers at least
//      one registered writer; a writer limited to sources names registered
//      ones.
//   2. policy: every model of the user-owned registry is in the datamodel and
//      every credential-shaped model (one with a field the default redaction
//      rule names) is either `exclude`d or lists only metadata (the #688
//      tripwire, extended to the export side).
//   3. secret-egress: every registered model filled with SENTINEL values, the
//      `user-data` and `org-data` sources run through EVERY writer they offer,
//      and no sentinel of a redacted field (a secret-like name, the entry's
//      `exportOmit`, a `Bytes` column, an excluded model) appears in any byte of
//      any output, zips decompressed. The fake client ignores `select`, so the
//      proof holds even for a client that returned every column.
//
// The spirit of the AI slice's `ai-secret-egress` spec, for exports.
// =============================================================================

import { Writable } from 'node:stream';

import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { userOwnedModelRegistry } from '../../core/index';
import { delegateNameOf, isRedactedExportField, type ExportDatamodel, type ExportDatamodelModel } from '../datamodel';
import { exportSourceRegistry, exportWriterRegistry, writersFor } from '../export.registries';
import type { ExportContext, ExportDb, ExportRow, ExportTable, ExportWriter, ExportWriteResult } from '../export.types';
import { ORG_DATA_EXPORT_SOURCE_ID } from '../sources/org-data.source';
import { USER_DATA_EXPORT_SOURCE_ID } from '../sources/user-data.source';
import { exportFileText } from './zip';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The exports slice's suite: its options, or `false` to opt out. Registered by importing `@marinoscar/platform-api/exports/testing`. */
    exports?: ExportsConformanceOptions | false;
  }
}

/**
 * What the `exports` suite takes: the app's data, never its code.
 *
 * @stability experimental
 */
export interface ExportsConformanceOptions {
  /** The app's `Prisma.dmmf.datamodel`. */
  readonly datamodel: ExportDatamodel;
  /** The app's permission registry (`id` of every permission). */
  readonly permissions: ReadonlyArray<{
    /** The permission id. */
    readonly id: string;
  }>;
}

const SUBJECT = '00000000-0000-4000-8000-0000000000aa';

/**
 * The sentinel a fake row carries in `model.field`. Letters, digits and `-`
 * only, so it survives every writer's escaping verbatim.
 *
 * @param model - the model name.
 * @param field - the field name.
 * @returns the sentinel.
 *
 * @stability experimental
 */
export function exportSentinel(model: string, field: string): string {
  return `S3NT1N3L-${model}-${field}-Z`;
}

/**
 * Writes `tables` with `writer` into memory.
 *
 * @param writer - the writer.
 * @param tables - the datasets.
 * @param source - the source id written into the file.
 * @returns the bytes and the writer's row counts.
 *
 * @example
 * ```ts
 * const { bytes } = await collectExportOutput(JSON_EXPORT_WRITER, tablesOf([{ dataset: 'a', title: 'A', columns, rows: [] }]));
 * ```
 *
 * @stability experimental
 */
export async function collectExportOutput(
  writer: ExportWriter,
  tables: AsyncIterable<ExportTable>,
  source = 'test',
): Promise<{ bytes: Buffer; result: ExportWriteResult }> {
  const chunks: Buffer[] = [];
  const out = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      callback();
    },
  });
  const result = await writer.write(tables, out, { source, exportedAt: new Date('2026-01-01T00:00:00.000Z'), appSlug: 'app' });
  return { bytes: Buffer.concat(chunks), result };
}

/**
 * Datasets with in-memory rows, as an async iterable (tests and examples).
 *
 * @param tables - the datasets, rows as arrays.
 * @returns the iterable.
 *
 * @stability experimental
 */
export async function* tablesOf(
  tables: ReadonlyArray<Omit<ExportTable, 'rows'> & { rows: readonly ExportRow[] | AsyncIterable<ExportRow> }>,
): AsyncGenerator<ExportTable> {
  for (const table of tables) {
    const rows = table.rows;
    yield {
      ...table,
      rows: (async function* () {
        if (Symbol.asyncIterator in rows) yield* rows as AsyncIterable<ExportRow>;
        else yield* rows as readonly ExportRow[];
      })(),
    };
  }
}

function sentinelValue(model: ExportDatamodelModel, field: ExportDatamodelModel['fields'][number]): unknown {
  const text = exportSentinel(model.name, field.name);
  if (field.kind === 'enum') return text;
  switch (field.type) {
    case 'Int':
    case 'Float':
    case 'Decimal':
      return 1;
    case 'BigInt':
      return BigInt(1);
    case 'Boolean':
      return true;
    case 'DateTime':
      return new Date(0);
    case 'Bytes':
      return Buffer.from(text, 'utf8');
    case 'Json':
      return { value: text };
    default:
      return field.isList ? [text] : text;
  }
}

/**
 * A fake bypass client: every model's delegate returns ONE row whose every
 * scalar field holds its sentinel, ignoring `select` (the worst case), then
 * nothing. `membership` rows carry a sentinel `user.email` and `role.name`.
 *
 * @param datamodel - the app's datamodel.
 * @returns the client.
 *
 * @stability experimental
 */
export function sentinelExportDb(datamodel: ExportDatamodel): ExportDb {
  const db: Record<string, unknown> = {};
  for (const model of datamodel.models) {
    let served = false;
    db[delegateNameOf(model.name)] = {
      findMany: async () => {
        if (served) return [];
        served = true;
        const row: Record<string, unknown> = {};
        for (const field of model.fields) {
          if (field.kind === 'scalar' || field.kind === 'enum') row[field.name] = sentinelValue(model, field);
        }
        if (model.name === 'Membership') {
          row.user = { email: exportSentinel('User', 'email') };
          row.role = { name: exportSentinel('Role', 'name') };
        }
        return [row];
      },
      findUnique: async () => null,
      findFirst: async () => null,
    };
  }
  return db;
}

/**
 * The sentinels that must NEVER appear in one source's export: every field
 * the default redaction rule names, every `Bytes` field, every registry
 * entry's `exportOmit`, and every field of a model the user-owned registry
 * excludes (except the rows `org-data` reads by design: the organization
 * itself and its memberships).
 *
 * @param datamodel - the app's datamodel.
 * @param source - the source whose output is checked.
 * @returns the forbidden sentinels.
 *
 * @stability experimental
 */
export function forbiddenExportSentinels(datamodel: ExportDatamodel, source: string = USER_DATA_EXPORT_SOURCE_ID): string[] {
  const readByDesign = source === ORG_DATA_EXPORT_SOURCE_ID ? new Set(['Organization', 'Membership']) : new Set(['User']);
  const forbidden: string[] = [];
  for (const model of datamodel.models) {
    const def = userOwnedModelRegistry.get(model.name);
    const excluded = def?.export === 'exclude' && !readByDesign.has(model.name);
    for (const field of model.fields) {
      if (field.kind !== 'scalar' && field.kind !== 'enum') continue;
      if (isRedactedExportField(field.name) || field.type === 'Bytes' || excluded || (def?.exportOmit ?? []).includes(field.name)) {
        forbidden.push(exportSentinel(model.name, field.name));
      }
    }
  }
  return forbidden;
}

/**
 * Runs the `user-data` and `org-data` sources (those registered) through
 * every writer they offer over {@link sentinelExportDb}.
 *
 * @param options - the suite's options.
 * @returns one entry per source and writer: the output's searchable text.
 *
 * @stability experimental
 */
export async function runSentinelExports(
  options: ExportsConformanceOptions,
): Promise<Array<{ source: string; format: string; text: string }>> {
  const outputs: Array<{ source: string; format: string; text: string }> = [];
  for (const id of [USER_DATA_EXPORT_SOURCE_ID, ORG_DATA_EXPORT_SOURCE_ID]) {
    const source = exportSourceRegistry.get(id);
    if (!source) continue;
    for (const writer of writersFor(source)) {
      const ctx: ExportContext = {
        exportId: '00000000-0000-4000-8000-0000000000ee',
        scope: source.scope,
        subjectId: SUBJECT,
        requestedById: SUBJECT,
        db: sentinelExportDb(options.datamodel),
        datamodel: options.datamodel,
        pageSize: 10,
        now: new Date('2026-01-01T00:00:00.000Z'),
      };
      const { bytes } = await collectExportOutput(writer, source.collect(ctx, source.requestSchema.parse({})), source.id);
      outputs.push({ source: source.id, format: writer.id, text: exportFileText(bytes) });
    }
  }
  return outputs;
}

/**
 * The registry and policy checks.
 *
 * @param options - the suite's options.
 * @returns one finding per problem.
 *
 * @stability experimental
 */
export function checkExportRegistries(options: ExportsConformanceOptions): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const permissions = new Set(options.permissions.map((p) => p.id));
  for (const source of exportSourceRegistry.list()) {
    if (!permissions.has(source.permission)) {
      findings.push({ file: `source:${source.id}`, message: `permission ${source.permission} is not a registered permission` });
    }
    if (source.crossOrgPermission !== undefined && !permissions.has(source.crossOrgPermission)) {
      findings.push({ file: `source:${source.id}`, message: `crossOrgPermission ${source.crossOrgPermission} is not a registered permission` });
    }
    if (writersFor(source).length === 0) findings.push({ file: `source:${source.id}`, message: 'offers no registered writer' });
  }
  for (const writer of exportWriterRegistry.list()) {
    for (const id of writer.sources ?? []) {
      if (!exportSourceRegistry.has(id)) findings.push({ file: `writer:${writer.id}`, message: `is limited to unknown source "${id}"` });
    }
  }
  const models = new Map(options.datamodel.models.map((model) => [model.name, model]));
  for (const def of userOwnedModelRegistry.list()) {
    const model = models.get(def.model);
    if (!model) {
      findings.push({ file: `model:${def.model}`, message: 'is registered as user-owned but is not in the datamodel' });
      continue;
    }
    if (def.export !== 'include') continue;
    for (const field of def.exportOmit ?? []) {
      if (!model.fields.some((f) => f.name === field)) {
        findings.push({ file: `model:${def.model}`, message: `exportOmit names unknown field "${field}"` });
      }
    }
  }
  return findings;
}

/**
 * The `exports` conformance suite. Registered when
 * `@marinoscar/platform-api/exports/testing` is imported.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const exportsConformanceSuite: ConformanceSuite<ExportsConformanceOptions> = {
  id: 'exports',
  title: 'the exports slice keeps its invariants',
  description:
    'Every source names a registered permission and offers a registered writer, the user-owned registry agrees with the datamodel, and no secret, hash or hint reaches any export file.',
  check(_context, options): ConformanceReport {
    return {
      scanned: { sources: exportSourceRegistry.size, writers: exportWriterRegistry.size, models: options.datamodel.models.length },
      scannedFiles: { sources: exportSourceRegistry.ids(), writers: exportWriterRegistry.ids() },
      findings: checkExportRegistries(options),
    };
  },
  cases(options): ConformanceCase[] {
    return [
      {
        name: 'registry: every source names a registered permission and offers a registered writer',
        run: (report, expect) => {
          expect(report.scanned.sources).toBeGreaterThanOrEqual(1);
          expect(report.findings.filter((f) => f.file.startsWith('source:') || f.file.startsWith('writer:'))).toEqual([]);
        },
      },
      {
        name: 'policy: every user-owned model exists and its exportOmit names real fields',
        run: (report, expect) => {
          expect(report.findings.filter((f) => f.file.startsWith('model:'))).toEqual([]);
        },
      },
      {
        name: 'secret-egress: no secret, hash or hint sentinel appears in any export, with every writer',
        run: async (_report, expect) => {
          const outputs = await runSentinelExports(options);
          expect(outputs.length).toBeGreaterThanOrEqual(1);
          const leaks = outputs.flatMap((output) => {
            const forbidden = forbiddenExportSentinels(options.datamodel, output.source);
            expect(forbidden.length).toBeGreaterThanOrEqual(1);
            return forbidden.filter((sentinel) => output.text.includes(sentinel)).map((sentinel) => `${output.source}/${output.format}: ${sentinel}`);
          });
          expect(leaks).toEqual([]);
          // Not vacuous: the exports did carry the user's ordinary data.
          for (const output of outputs) expect(output.text).toContain('S3NT1N3L-');
        },
      },
    ];
  },
};

if (!conformanceSuites.has(exportsConformanceSuite.id)) conformanceSuites.register(exportsConformanceSuite);
