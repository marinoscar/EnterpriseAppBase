import { DynamicModule, Global, Module, type ModuleMetadata, type Provider } from '@nestjs/common';

import type { PortBinding } from '../../core/index';
import type { StorageProvider } from './storage-provider.interface';

// =============================================================================
// The app's STORAGE_PROVIDER binding, visible to every package consumer (PP-14.1)
// =============================================================================
//
// WHY THIS EXISTS. `STORAGE_PROVIDER` is provided by `StorageProvidersModule`,
// which sixteen package files import (the objects API, profile images, exports,
// user data, database backup, the nodes data plane, ...). Nest resolves a token
// from the consuming module's own providers and imports first, so a provider of
// the token in the APP's module is invisible to all of them: the documented
// "provide STORAGE_PROVIDER in your app module" never worked.
//
// THE DESIGN. `StorageModule.forRoot({ provider })` imports this module, which is
// `@Global()` and provides ONE private token, {@link STORAGE_PROVIDER_BINDING},
// from the app's binding. `StorageProvidersModule` (unchanged as an import in
// all sixteen files) provides `STORAGE_PROVIDER` as "the binding if one exists,
// else `ResolvingStorageProvider`". Because the holder is global, the sixteen
// importers needed no edit and no `forRoot` of their own; because the token is
// OPTIONAL there, an app that passes no `provider` gets exactly the previous
// wiring.
//
// REJECTED: making `StorageProvidersModule` itself a dynamic module. Every
// importer would then have to import the SAME configured instance (a bare
// `StorageProvidersModule` and `StorageProvidersModule.forRoot(...)` are two
// different modules to Nest), which is a sixteen-file change that each package
// module could silently get wrong.
//
// The binding is resolved in this module's context, so its dependencies (for a
// `useClass` or `useFactory`) come from `options.imports` of `forRoot` and from
// global modules, exactly as for `PlatformHostModule.forRoot`'s ports.
// =============================================================================

/**
 * Injection token of the app's {@link StorageProvider} binding: present only
 * when `StorageModule.forRoot({ provider })` was given one. Read by
 * `StorageProvidersModule` (optionally); apps use `STORAGE_PROVIDER` instead.
 *
 * @stability experimental
 */
export const STORAGE_PROVIDER_BINDING: unique symbol = Symbol.for('@marinoscar/platform/storage/STORAGE_PROVIDER_BINDING');

/**
 * Holds the app's `provider` binding for the whole application. Imported by
 * `StorageModule.forRoot` when the `provider` option is set; not meant to be
 * imported directly.
 *
 * @stability experimental
 */
@Global()
@Module({})
export class StorageProviderBindingModule {
  /**
   * The holder for one binding.
   *
   * @param binding - the app's provider binding (`useExisting`, `useClass` or `useFactory`).
   * @param imports - modules the binding's dependencies come from.
   * @returns the global dynamic module exporting {@link STORAGE_PROVIDER_BINDING}.
   */
  static forBinding(binding: PortBinding<StorageProvider>, imports: ModuleMetadata['imports'] = []): DynamicModule {
    return {
      module: StorageProviderBindingModule,
      global: true,
      imports: [...imports],
      providers: [{ provide: STORAGE_PROVIDER_BINDING, ...binding } as Provider],
      exports: [STORAGE_PROVIDER_BINDING],
    };
  }
}
