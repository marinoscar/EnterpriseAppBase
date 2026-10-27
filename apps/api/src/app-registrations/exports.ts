import type { ExportSource, ExportWriter } from '@marinoscar/platform-api/exports';

/**
 * This app's own export sources and writers (issue #744). Upstream keeps both
 * arrays empty forever; a fork adds its domain sources (EvoPath's `health`,
 * kvox's `transcript`) and writers (a domain PDF limited to its source with
 * `sources: ['health']`) here, and `platform/exports/export-registrations.manifest.ts`
 * registers them after the platform's `user-data` / `org-data` sources and the
 * `json` / `csv` / `xlsx` writers.
 *
 * Pure data: no `register()` calls, no Nest, no services. A source reads
 * through `ctx.db` (the bypass client) with an explicit owner or organization
 * filter, pages its queries and never writes. Recipe and contracts:
 * `packages/platform-api/src/exports/README.md`.
 *
 * @example
 * ```ts
 * export const APP_EXPORT_SOURCES: readonly ExportSource<any>[] = [
 *   { id: 'health', scope: 'user', label: 'Health data', permission: 'health_data:read',
 *     requestSchema: healthExportRequestSchema, formats: ['json', 'csv', 'xlsx', 'health-pdf'],
 *     collect: (ctx, req) => healthTables(ctx, req) },
 * ];
 * ```
 */
export const APP_EXPORT_SOURCES: readonly ExportSource<any>[] = [];

/** This app's own export writers, registered after the built-in ones. */
export const APP_EXPORT_WRITERS: readonly ExportWriter[] = [];
