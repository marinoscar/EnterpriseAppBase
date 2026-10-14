import { DynamicModule, Module } from '@nestjs/common';

import { StorageCleanupHandler } from './handlers/storage-cleanup.handler';
import { StorageObjectProcessHandler } from './handlers/storage-object-process.handler';
import { ObjectsController } from './objects/objects.controller';
import { ObjectsService } from './objects/objects.service';
import { ObjectProcessingModule } from './processing/object-processing.module';
import { StorageProviderBindingModule } from './providers/storage-provider.binding';
import { StorageProvidersModule } from './providers/storage-providers.module';
import { StorageStatusController } from './status/storage-status.controller';
import { registerStorageSliceKeyPrefixes } from './storage-key-prefixes';
import { STORAGE_OPTIONS, resolveStorageModuleOptions, type StorageModuleOptions } from './storage.options';
import { StorageCleanupTask } from './tasks/storage-cleanup.task';

// =============================================================================
// StorageModule (issue #736, PP-8.3; objects API #150, cleanup job #353,
// processing job #520)
// =============================================================================
//
// The objects API (`/api/storage/objects`, `storage:read|write`,
// `storage:delete_any`), `GET /api/storage/status`, the two queue job types
// (`storage.cleanup.stale-uploads`, `storage.object.process`, both
// server-only, both PERMANENT strings) and the daily cleanup cron, which only
// enqueues (`enqueueHousekeepingJob`).
//
// `JobsModule.forRoot()` (`@marinoscar/platform-api/jobs`) is GLOBAL, so
// `JobsService` and `JobHandlerRegistry` need no import here; nothing in the
// jobs slice imports storage. The processor registry and runner come from
// `ObjectProcessingModule`; `ObjectsService` asks it whether an upload needs
// processing at all, and `StorageObjectProcessHandler` runs it.
// =============================================================================

/**
 * The storage slice's objects API, its status route, the stale-upload sweep
 * and the post-upload processing job.
 *
 * Needs, from the app: `JobsModule.forRoot()` (global), `SettingsModule.forRoot()`
 * (global), the core `PlatformHostModule` (`PLATFORM_PRISMA`), the
 * `STORAGE_SYSTEM_DATA` port, the credential store's encryption key and the
 * `@fastify/multipart` plugin registered on the Fastify instance (the simple
 * upload route; `simpleUploadFileSizeLimit` gives its limit).
 *
 * @stability experimental
 */
@Module({})
export class StorageModule {
  /**
   * The slice for one app. Call once. Registers the slice's own object-key
   * prefixes (`uploads`, `avatars`, `node-outputs`, `storage-config-test`;
   * idempotent).
   *
   * @param options - deployment tuning, and the `provider` binding that replaces the default object store; see {@link StorageModuleOptions}.
   * @returns the dynamic module. It exports `ObjectsService` and `STORAGE_OPTIONS`.
   * @throws Error when an option is invalid.
   *
   * @example
   * ```ts
   * export const StorageModule = PlatformStorageModule.forRoot({});
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: StorageModuleOptions = {}): DynamicModule {
    const resolved = resolveStorageModuleOptions(options);
    registerStorageSliceKeyPrefixes();

    return {
      module: StorageModule,
      imports: [
        ...resolved.imports,
        // The app's object store, visible to every package consumer of
        // STORAGE_PROVIDER (global; see `storage-provider.binding.ts`).
        ...(resolved.provider ? [StorageProviderBindingModule.forBinding(resolved.provider, resolved.imports)] : []),
        StorageProvidersModule,
        ObjectProcessingModule,
      ],
      controllers: [ObjectsController, StorageStatusController],
      providers: [
        { provide: STORAGE_OPTIONS, useValue: resolved },
        ObjectsService,
        StorageCleanupTask,
        StorageCleanupHandler,
        StorageObjectProcessHandler,
      ],
      exports: [STORAGE_OPTIONS, ObjectsService],
    };
  }
}
