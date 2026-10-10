import { DynamicModule, Global, Module, type ForwardReference, type Type } from '@nestjs/common';

import { AI_MODULE_OPTIONS, DEFAULT_AI_OPTIONS, type AiResolvedOptions } from './ai.options';

import { AiCatalogModule } from './catalog/ai-catalog.module';
import { AiConfigModule } from './config/ai-config.module';
import { AiCoreModule } from './core/ai-core.module';
import { AiFeaturesModule } from './features/ai-features.module';
import { AiHttpModule } from './http/ai-http.module';
import { AiKeysModule } from './keys/ai-keys.module';
import { aiProviderKind, requireAiProviderDefinition } from './providers/ai-provider-definition';
// Registers the five built-in providers (side effect) before the registry is read.
import './providers/builtin-ai-providers';
import { AiRuntimeModule } from './runtime/ai-runtime.module';
import { registerAiStorageKeyPrefixes } from './storage/ai-storage-key-prefixes';
import { AiUsageModule } from './usage/ai-usage.module';

/**
 * A provider id accepted by {@link AiModuleOptions.providers}: any id
 * registered with `registerAiProvider`.
 *
 * @deprecated Since PP-14.6 (#924) the provider list is open: this is `string`,
 *   kept as an alias for one release.
 * @stability experimental
 */
export type AiProviderModuleId = string;

/**
 * Options of {@link AiModule.forRoot}. No option is an environment variable:
 * keys, models and limits are runtime configuration (the `ai` settings
 * namespace and the credential stores).
 *
 * @stability experimental
 */
export interface AiModuleOptions {
  /**
   * The ids of the providers whose modules to load. Default: every provider
   * registered with `registerAiProvider` when `forRoot` is called (the five
   * built-ins, and an app's or package's own: register them first, at import
   * time). An unloaded provider is simply absent from the adapter registry
   * (its settings slot stays, inert). An id with no registered definition
   * throws, naming the registered ones.
   */
  readonly providers?: readonly string[];
  /**
   * The modules binding the slice's host ports (`AI_SYSTEM_PRISMA`,
   * `AI_OBJECT_STORE`, optionally `AI_METRICS` and `AI_TARGET_RESOLVER`).
   * Each must be `@Global()`, since every sub-module injects them.
   */
  readonly imports?: ReadonlyArray<Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference>;
  /**
   * Whether users may pick their own default model (the `ai.defaultModel`
   * user setting). Default `true`. `false` for an app whose AI features pick
   * their model themselves (an `AI_TARGET_RESOLVER`): the default resolver
   * then ignores the setting and `GET /api/ai/config` reports
   * `perUserDefaultModel: false`, so the web hides the picker.
   */
  readonly perUserDefaultModel?: boolean;
}

/** Holds the resolved options for every AI module (global, so no import edge is needed). */
@Global()
@Module({})
class AiOptionsModule {
  static of(options: AiResolvedOptions): DynamicModule {
    return {
      module: AiOptionsModule,
      providers: [{ provide: AI_MODULE_OPTIONS, useValue: options }],
      exports: [AI_MODULE_OPTIONS],
    };
  }
}

/**
 * The AI platform's root module (epic #419; packaged by #739).
 *
 * Deliberately just a list of imports: core, the provider modules, catalog,
 * config, keys, runtime, HTTP and usage, each a module of its own. A feature
 * module of the app imports the one configured `AiModule` and injects
 * `AiService`.
 *
 * @example
 * ```ts
 * export const AiModule = PlatformAiModule.forRoot({ imports: [AiHostModule] });
 * ```
 *
 * @stability experimental
 */
@Module({})
export class AiModule {
  /**
   * The configured module. Call once and import that object everywhere.
   *
   * @param options - the provider list and the host-port modules.
   * @returns the dynamic module, exporting `AiCoreModule`, `AiConfigModule` and `AiRuntimeModule`.
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: AiModuleOptions = {}): DynamicModule {
    const wanted = options.providers ?? aiProviderKind.ids();
    // Throws PluggableUnknownError for an unregistered id, naming it, the
    // registered ids and how to register one.
    const providers = [...new Set(wanted)].map((id) => requireAiProviderDefinition(id));
    // The slice's own object-key prefix (`ai-outputs/`), with the storage
    // slice's registry; a no-op when the app's manifest registered it already.
    registerAiStorageKeyPrefixes();
    const resolved: AiResolvedOptions = Object.freeze({
      perUserDefaultModel: options.perUserDefaultModel ?? DEFAULT_AI_OPTIONS.perUserDefaultModel,
    });

    return {
      module: AiModule,
      imports: [
        AiOptionsModule.of(resolved),
        ...(options.imports ?? []),
        AiCoreModule,
        ...providers.map((definition) => definition.module),
        AiCatalogModule,
        AiConfigModule,
        AiKeysModule,
        AiRuntimeModule,
        AiHttpModule,
        AiUsageModule,
        // #739: `GET /api/ai/features`. Last, so the routes before it keep their OpenAPI order.
        AiFeaturesModule,
      ],
      // `AiRuntimeModule` is re-exported so a feature module can simply
      // `imports: [AiModule]` and inject `AiService`.
      exports: [AiCoreModule, AiConfigModule, AiRuntimeModule],
    };
  }
}
