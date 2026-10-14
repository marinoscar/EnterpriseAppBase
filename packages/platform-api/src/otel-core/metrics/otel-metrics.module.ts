// The metrics host's module (issue #700): global, so every slice and app
// module injects `MetricsHostService` without importing it, like the app's
// own `AppMetricsModule` before it. The host slice's `PlatformHostCoreModule`
// imports it (#867).

import { Global, Module, type DynamicModule, type InjectionToken, type ModuleMetadata } from '@nestjs/common';

import { METRICS_HOST_OPTIONS, MetricsHostService, type MetricsHostOptions } from './metrics-host.service';

/**
 * Options of {@link OtelMetricsModule.forRootAsync}: a factory for
 * {@link MetricsHostOptions}, typically reading the app's configuration.
 *
 * @stability experimental
 */
export interface OtelMetricsModuleAsyncOptions {
  /** Modules exporting the factory's dependencies (a global `ConfigModule` needs none). */
  imports?: ModuleMetadata['imports'];
  /** Tokens injected into `useFactory`, in order. */
  inject?: InjectionToken[];
  /** Builds the options; may be async. */
  useFactory: (...args: never[]) => MetricsHostOptions | Promise<MetricsHostOptions>;
}

/**
 * Global module providing {@link MetricsHostService}. Import it once, in the
 * root module or in the app's own metrics module: bare (every default), with
 * `forRoot(options)` or with `forRootAsync({ inject, useFactory })`.
 *
 * @stability experimental
 */
@Global()
@Module({
  providers: [MetricsHostService],
  exports: [MetricsHostService],
})
export class OtelMetricsModule {
  /**
   * The module with fixed host options.
   *
   * @param options - See {@link MetricsHostOptions}.
   * @returns A global dynamic module.
   *
   * @stability experimental
   */
  static forRoot(options: MetricsHostOptions = {}): DynamicModule {
    return {
      module: OtelMetricsModule,
      global: true,
      providers: [{ provide: METRICS_HOST_OPTIONS, useValue: options }, MetricsHostService],
      exports: [MetricsHostService, METRICS_HOST_OPTIONS],
    };
  }

  /**
   * The module with host options built by a factory (for example from the
   * app's `ConfigService`).
   *
   * @param options - See {@link OtelMetricsModuleAsyncOptions}.
   * @returns A global dynamic module.
   *
   * @example
   * ```ts
   * OtelMetricsModule.forRootAsync({
   *   inject: [ConfigService],
   *   useFactory: (config: ConfigService) => ({ gauges: config.get<boolean>('otel.enabled') === true }),
   * });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRootAsync(options: OtelMetricsModuleAsyncOptions): DynamicModule {
    return {
      module: OtelMetricsModule,
      global: true,
      imports: options.imports ?? [],
      providers: [
        {
          provide: METRICS_HOST_OPTIONS,
          inject: options.inject ?? [],
          useFactory: options.useFactory as (...args: unknown[]) => MetricsHostOptions | Promise<MetricsHostOptions>,
        },
        MetricsHostService,
      ],
      exports: [MetricsHostService, METRICS_HOST_OPTIONS],
    };
  }
}
