import { DynamicModule, Global, Module, type ForwardReference, type Provider, type Type } from '@nestjs/common';

import type { PortBinding } from '../core/index';

import { AI_MODULE_OPTIONS, DEFAULT_AI_OPTIONS, type AiResolvedOptions } from './ai.options';
import { AI_PRICING, type AiPricing } from './ports';

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
  /**
   * The deployment's price list (PP-14.17, #935): turns recorded usage into a
   * cost, shown as a Cost column on the usage pages. `useExisting` names a
   * provider a module in `imports` exports; `useClass` and `useFactory` take
   * their dependencies from `imports` and the global modules. Bound here and
   * not in an app module because Nest resolves a token from the consuming
   * module's own providers and imports, so an app-level provider would be
   * invisible to the usage service. Absent: no cost anywhere (the platform
   * ships no rates).
   *
   * @example
   * ```ts
   * AiModule.forRoot({ imports: [AiHostModule], pricing: { useClass: RateCardPricing } });
   * ```
   */
  readonly pricing?: PortBinding<AiPricing>;
}

/** Holds the resolved options for every AI module (global, so no import edge is needed). */
@Global()
@Module({})
class AiOptionsModule {
  static of(
    options: AiResolvedOptions,
    pricing?: PortBinding<AiPricing>,
    imports: AiModuleOptions['imports'] = [],
  ): DynamicModule {
    return {
      module: AiOptionsModule,
      // The app's host modules are imported here too, so a `useExisting` /
      // `useClass` pricing binding resolves its dependencies from them.
      imports: pricing ? [...imports] : [],
      providers: [
        { provide: AI_MODULE_OPTIONS, useValue: options },
        ...(pricing ? [{ provide: AI_PRICING, ...pricing } as Provider] : []),
      ],
      exports: [AI_MODULE_OPTIONS, ...(pricing ? [AI_PRICING] : [])],
    };
  }
}

/** The binding must be one of Nest's three provider shapes, or boot fails naming the option. */
function assertPortBinding(name: string, binding: PortBinding<unknown>): void {
  const shapes = ['useExisting', 'useClass', 'useFactory'].filter((key) => key in (binding as object));

  if (shapes.length !== 1) {
    throw new Error(`AiModule.forRoot({ ${name} }): bind it with exactly one of useExisting, useClass or useFactory.`);
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
    if (options.pricing) assertPortBinding('pricing', options.pricing);
    const resolved: AiResolvedOptions = Object.freeze({
      perUserDefaultModel: options.perUserDefaultModel ?? DEFAULT_AI_OPTIONS.perUserDefaultModel,
    });

    return {
      module: AiModule,
      imports: [
        AiOptionsModule.of(resolved, options.pricing, options.imports),
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
