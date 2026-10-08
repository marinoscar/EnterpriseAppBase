// =============================================================================
// The export framework's contracts: tables, sources and writers (issue #744)
// =============================================================================
//
// A SOURCE turns a request into datasets (`ExportTable`s); a WRITER serialises
// datasets into one file. The `export.run` job pairs one of each: it asks the
// source for its tables and streams the writer's output straight into object
// storage. Neither side ever holds a whole table: `rows` is an
// `AsyncIterable`, a writer writes to a `Writable` with backpressure, and the
// upload consumes it as it is produced (the backup engine's "never buffered"
// discipline, and kvox's "`render` streams, it does not return a buffer").
//
// The shapes are EvoPath's (`health-export-data.ts`: `ExportCell`,
// `ExportColumn`, `ExportTable`) with `rows` made lazy, and kvox's exporter
// contract for writers (a `Writable` out, ended by the writer).
// =============================================================================

import type { Writable } from 'node:stream';

import type { ExportCell, ExportColumn, ExportRequestField, ExportScope } from '@marinoscar/platform-contract/exports';
import type { z } from 'zod';

import type { ExportDatamodel } from './datamodel';

export type { ExportCell, ExportColumn, ExportRequestField, ExportScope };

/**
 * One row of a dataset, keyed by column key. A key a row lacks is written as
 * `null`.
 *
 * @stability experimental
 */
export type ExportRow = Readonly<Record<string, ExportCell>>;

/**
 * One dataset: a named, titled table whose rows arrive lazily.
 *
 * @stability experimental
 */
export interface ExportTable {
  /** The dataset name (`personal_access_token`): a JSON key and a zip entry name; matches `EXPORT_DATASET_PATTERN`. */
  readonly dataset: string;
  /** The human title: an XLSX sheet name, a heading. */
  readonly title: string;
  /** The columns, in order. */
  readonly columns: readonly ExportColumn[];
  /**
   * The rows, produced on demand. A source pages its query (cursor by id) and
   * yields as it goes; it never loads a whole table. Iterated exactly once.
   */
  readonly rows: AsyncIterable<ExportRow>;
}

/**
 * The client a source reads through: the app's bypass client (`asSystem`),
 * seen untyped. Every query names its owner or organization explicitly; row-
 * level security does not filter it (that is the point: a user's own rows sit
 * in several organizations, and an organization's export must see every row
 * of that organization whoever's scope is active).
 *
 * @stability experimental
 */
export type ExportDb = { readonly [delegate: string]: any };

/**
 * What a source's `collect` receives.
 *
 * @stability experimental
 */
export interface ExportContext {
  /** The export (job) id. */
  readonly exportId: string;
  /** The source's scope. */
  readonly scope: ExportScope;
  /** Whose data: the user id (`user` scope) or the organization id (`org` scope). */
  readonly subjectId: string;
  /** The user who asked for it. */
  readonly requestedById: string;
  /** The client to read through ({@link ExportDb}); read-only use only. */
  readonly db: ExportDb;
  /** The app's data model (`Prisma.dmmf.datamodel`), for sources that derive columns from it. */
  readonly datamodel: ExportDatamodel;
  /** Rows per page when a source pages a query. */
  readonly pageSize: number;
  /** The export's clock: one instant for the whole export. */
  readonly now: Date;
}

/**
 * A registered source of export data (rung 2).
 *
 * @typeParam Req - the parsed request.
 *
 * @stability experimental
 * @example
 * ```ts
 * registerExportSource({
 *   id: 'health', scope: 'user', label: 'Health data', permission: 'health_data:read',
 *   requestSchema: z.object({ from: z.iso.date(), to: z.iso.date() }).strict(),
 *   formats: ['json', 'csv', 'xlsx'],
 *   async *collect(ctx, req) { yield healthTable(ctx, req); },
 * });
 * ```
 */
export interface ExportSource<Req = unknown> {
  /** Permanent once jobs carry it, e.g. `'user-data'`; matches `EXPORT_ID_PATTERN`. */
  readonly id: string;
  /** Whose data it exports. */
  readonly scope: ExportScope;
  /** What the dialog calls it. */
  readonly label: string;
  /** One sentence about what it contains. */
  readonly description?: string;
  /** The exact permission string the route enforces for this source. */
  readonly permission: string;
  /**
   * `org` scope only: the permission that lets a caller export an
   * organization OTHER than the active one (a system administrator's
   * `organizations:read`). Without it, only the active organization.
   */
  readonly crossOrgPermission?: string;
  /** Validated at the route AND when the job starts; `.strict()` recommended. */
  readonly requestSchema: z.ZodType<Req>;
  /** The request fields the dialog draws; derived from `requestSchema` when absent. */
  readonly fields?: readonly ExportRequestField[];
  /** The writer ids it offers, in display order; a subset of the registered writers. */
  readonly formats: readonly string[];
  /**
   * The datasets. READ-ONLY: never writes a row. Pages its queries and yields
   * tables lazily; must not load whole tables into memory.
   */
  collect(ctx: ExportContext, req: Req): AsyncIterable<ExportTable>;
  /**
   * The download name, without the extension's dot handled for you:
   * return the full name. Must match `EXPORT_FILE_NAME_PATTERN`. Default
   * `<app-slug>-<source>-<YYYY-MM-DD>.<ext>`.
   */
  fileName?(ctx: ExportContext, req: Req, ext: string): string;
}

/**
 * What a writer receives besides the tables.
 *
 * @stability experimental
 */
export interface ExportWriteContext {
  /** The source id. */
  readonly source: string;
  /** When the export was produced. */
  readonly exportedAt: Date;
  /** The app's file-name slug (`my-app`), for document metadata. */
  readonly appSlug: string;
}

/**
 * What a writer reports when it finished.
 *
 * @stability experimental
 */
export interface ExportWriteResult {
  /** Rows written per dataset. */
  readonly rowCounts: Readonly<Record<string, number>>;
}

/**
 * A registered output format (rung 2).
 *
 * THE CONTRACT (kvox's, kept): `write` writes the complete file to `out` and
 * ENDS it; the returned promise settles only once `out` has finished; a
 * failure rejects AND destroys `out`, so a half-written file never reaches
 * storage looking complete. It honours backpressure (`writeChunk`), so it
 * never buffers the file.
 *
 * @stability experimental
 * @example
 * ```ts
 * registerExportWriter({
 *   id: 'ndjson', label: 'NDJSON', mimeType: 'application/x-ndjson', extension: 'ndjson',
 *   async write(tables, out) { ... },
 * });
 * ```
 */
export interface ExportWriter {
  /** The format id (`csv`); permanent once jobs carry it. */
  readonly id: string;
  /** What the dialog calls it. */
  readonly label: string;
  /** The file's media type (`application/zip` for `csv`). */
  readonly mimeType: string;
  /** The file's extension, without the dot (`zip` for `csv`). */
  readonly extension: string;
  /** Limits the writer to these sources (a domain PDF); absent means any source that lists it. */
  readonly sources?: readonly string[];
  /** Serialises `tables` into `out`. See the contract above. */
  write(tables: AsyncIterable<ExportTable>, out: Writable, ctx: ExportWriteContext): Promise<ExportWriteResult>;
}
