import { Module } from '@nestjs/common';

import { CredentialsModule } from '../../credentials/index';
import { StorageConfigService } from '../config/storage-config.service';
import { ResolvingStorageProvider } from './resolving-storage.provider';
import { STORAGE_PROVIDER_BINDING } from './storage-provider.binding';
import { STORAGE_PROVIDER, type StorageProvider } from './storage-provider.interface';

/**
 * Storage Providers Module
 * Provides dependency injection for storage provider implementations
 *
 * `STORAGE_PROVIDER` resolves to `ResolvingStorageProvider` (#373, epic #372),
 * which reads the `storage` system-settings namespace and the credential store
 * PER CALL and delegates to a client built for whatever it finds. The token,
 * the interface and the export list are unchanged, so the six modules that
 * import this one — and the nine consumers that inject the token — are
 * unaffected by the switch.
 *
 * WHY `useClass` STILL, AND NOT `useFactory`. A factory would resolve the
 * configuration once, at boot: no live reconfiguration, and a fresh install
 * with no storage configured could not start. The reasoning is set out in full
 * at the top of `resolving-storage.provider.ts`.
 *
 * TWO NEW IMPORTS, AND NO CYCLE:
 *
 *   * `SettingsModule` for `SystemSettingsService.getStoragePolicy()`. It is
 *     safe because `SettingsModule` is a LEAF — it imports nothing — which is
 *     the property `profile-image.module.ts` already documents and relies on
 *     ("`StorageModule` to `JobsModule` to `SettingsModule` already exists, so
 *     settings importing storage would be a cycle"). Nothing here makes
 *     settings depend on storage, and nothing may: if a future change needs
 *     `SettingsModule` to read storage, the fix is a third module, never a
 *     `forwardRef` pair.
 *   * `CredentialsModule` for the secret access key. It is deliberately not
 *     `@Global()` — "requiring `imports: [CredentialsModule]` makes every new
 *     consumer a visible line in a diff" — and this line is that diff.
 *
 * `StorageConfigService` IS EXPORTED, and part 3 of #373 is the change that
 * made it so: the services that record the ACTIVE PROVIDER ID onto a row asked
 * `StorageConfigService.activeProvider()`, so a row cannot name one
 * configuration's bucket and another's provider. Since PP-14.1 (#919) the rows
 * record `STORAGE_PROVIDER`'s own `kind` instead (so an app backend is not
 * recorded as `s3`); the export remains for the admin routes, the status route
 * and `DatabaseBackupRunnerService`'s freshness read.
 *
 * ⚠ EXPORTED, NOT `@Global()`. A consumer takes it by adding this module to its
 * `imports` — a visible line in a diff — exactly as `CredentialsModule`
 * requires of its own.
 *
 * To add an alternative provider (local filesystem, Azure Blob, etc.), pass it
 * as `StorageModule.forRoot({ provider })`. That binding is held by a global
 * module (`StorageProviderBindingModule`) and `STORAGE_PROVIDER` below prefers
 * it, so it reaches every module that imports this one with no change to any
 * of them. Providing `STORAGE_PROVIDER` in an app module does NOT work (Nest
 * resolves a token from the consuming module's imports first). Without the
 * option, the token is the `ResolvingStorageProvider`, as before.
 */
/**
 * The storage provider: `STORAGE_PROVIDER` (the app's `provider` binding when
 * `StorageModule.forRoot` was given one, else a {@link ResolvingStorageProvider}
 * reading the `storage` settings namespace and the credential store per call)
 * and `StorageConfigService`. Imported by every module that moves bytes or
 * records which provider holds them. `SettingsModule.forRoot()` is global, so
 * only the credential store is imported here.
 *
 * @stability stable
 */
@Module({
  imports: [CredentialsModule],
  providers: [
    StorageConfigService,
    ResolvingStorageProvider,
    {
      provide: STORAGE_PROVIDER,
      useFactory: (binding: StorageProvider | undefined, resolving: ResolvingStorageProvider): StorageProvider =>
        binding ?? resolving,
      inject: [{ token: STORAGE_PROVIDER_BINDING, optional: true }, ResolvingStorageProvider],
    },
  ],
  exports: [STORAGE_PROVIDER, StorageConfigService],
})
export class StorageProvidersModule {}
