import { DynamicModule, Global, Module, type ForwardReference, type Type } from '@nestjs/common';

import { AI_MODULE_OPTIONS, DEFAULT_AI_OPTIONS, type AiResolvedOptions } from './ai.options';

import { AiCatalogModule } from './catalog/ai-catalog.module';
import { AiConfigModule } from './config/ai-config.module';
import { AiCoreModule } from './core/ai-core.module';
import { AiFeaturesModule } from './features/ai-features.module';
import { AiHttpModule } from './http/ai-http.module';
import { AiKeysModule } from './keys/ai-keys.module';
import { AnthropicProviderModule } from './providers/anthropic/anthropic.module';
import { AzureOpenAiProviderModule } from './providers/azure-openai/azure-openai.module';
import { GeminiProviderModule } from './providers/gemini/gemini.module';
import { OpenAiProviderModule } from './providers/openai/openai.module';
import { OpenAiCompatibleProviderModule } from './providers/openai-compatible/openai-compatible.module';
import { AiRuntimeModule } from './runtime/ai-runtime.module';
import { registerAiStorageKeyPrefixes } from './storage/ai-storage-key-prefixes';
import { AiUsageModule } from './usage/ai-usage.module';

/**
 * The provider modules the slice ships, by provider id.
 *
 * @stability stable
 */
export type AiProviderModuleId = 'openai' | 'anthropic' | 'gemini' | 'azure-openai' | 'openai-compatible';

/** Every shipped provider, in registration (and admin UI) order. */
const PROVIDER_MODULES: ReadonlyArray<readonly [AiProviderModuleId, Type<unknown>]> = [
  ['openai', OpenAiProviderModule],
  ['anthropic', AnthropicProviderModule],
  ['gemini', GeminiProviderModule],
  ['azure-openai', AzureOpenAiProviderModule],
  ['openai-compatible', OpenAiCompatibleProviderModule],
];

/**
 * Options of {@link AiModule.forRoot}. No option is an environment variable:
 * keys, models and limits are runtime configuration (the `ai` settings
 * namespace and the credential stores).
 *
 * @stability experimental
 */
export interface AiModuleOptions {
  /**
   * Provider modules to load. Default: all five. An unloaded provider is
   * simply absent from the registry (its settings slot stays, inert).
   */
  readonly providers?: readonly AiProviderModuleId[];
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
    const wanted = new Set<AiProviderModuleId>(options.providers ?? PROVIDER_MODULES.map(([id]) => id));
    for (const id of wanted) {
      if (!PROVIDER_MODULES.some(([known]) => known === id)) {
        throw new Error(`AiModule.forRoot: unknown provider module "${id}"`);
      }
    }
    const providers = PROVIDER_MODULES.filter(([id]) => wanted.has(id)).map(([, module]) => module);
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
        ...providers,
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
