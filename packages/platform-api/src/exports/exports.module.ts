import { DynamicModule, Module } from '@nestjs/common';

import { registerStorageKeyPrefixes, StorageProvidersModule } from '../storage/index';
import { registerExportSource, registerExportWriter } from './export.registries';
import { ExportsController } from './exports.controller';
import { EXPORTS_KEY_PREFIXES } from './exports.constants';
import { EXPORTS_OPTIONS, resolveExportsModuleOptions, type ExportsModuleOptions } from './exports.options';
import { ExportsService } from './exports.service';
import { ExportPurgeHandler } from './handlers/export-purge.handler';
import { ExportRunHandler } from './handlers/export-run.handler';
import { ORG_DATA_EXPORT_SOURCE } from './sources/org-data.source';
import { USER_DATA_EXPORT_SOURCE } from './sources/user-data.source';
import { ExportPurgeTask } from './tasks/export-purge.task';
import { BUILTIN_EXPORT_WRITERS } from './writers/index';

// =============================================================================
// ExportsModule (issue #744, PP-9.2)
// =============================================================================
//
// `/api/exports`, the two job types (`export.run`, `export.purge`, both
// server-only, both PERMANENT strings) and the daily purge cron, which only
// enqueues (`enqueueHousekeepingJob`).
//
// `JobsModule.forRoot()` is GLOBAL, so `JobsService` and `JobHandlerRegistry`
// need no import; the core `PlatformHostModule` provides `PLATFORM_PRISMA` and
// `AUDIT_SINK`; `StorageProvidersModule` the provider and its configuration.
// The app binds `EXPORTS_SYSTEM_DATA` and (optionally) `EXPORTS_NOTIFIER` in a
// module it passes as `imports`.
// =============================================================================

/**
 * The exports slice for one app.
 *
 * @stability experimental
 */
@Module({})
export class ExportsModule {
  /**
   * The slice for one app. Call once, before bootstrap. Registers the
   * built-in writers (`json`, `csv`, `xlsx`), the platform sources
   * (`user-data`, `org-data`, unless `platformSources` turns one off) and the
   * slice's object-key prefixes; each registration is idempotent.
   *
   * @param options - see {@link ExportsModuleOptions}; `datamodel` is required.
   * @returns the dynamic module. It exports `ExportsService` and `EXPORTS_OPTIONS`.
   * @throws Error when an option is invalid.
   *
   * @example
   * ```ts
   * export const exportsModule = ExportsModule.forRoot({ datamodel: Prisma.dmmf.datamodel, imports: [ExportsHostModule] });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: ExportsModuleOptions): DynamicModule {
    const resolved = resolveExportsModuleOptions(options);
    for (const writer of BUILTIN_EXPORT_WRITERS) registerExportWriter(writer);
    if (resolved.platformSources.userData) registerExportSource(USER_DATA_EXPORT_SOURCE);
    if (resolved.platformSources.orgData) registerExportSource(ORG_DATA_EXPORT_SOURCE);
    registerStorageKeyPrefixes(EXPORTS_KEY_PREFIXES);

    return {
      module: ExportsModule,
      imports: [...resolved.imports, StorageProvidersModule],
      controllers: [ExportsController],
      providers: [
        { provide: EXPORTS_OPTIONS, useValue: resolved },
        ExportsService,
        ExportRunHandler,
        ExportPurgeHandler,
        ExportPurgeTask,
      ],
      exports: [EXPORTS_OPTIONS, ExportsService],
    };
  }
}
