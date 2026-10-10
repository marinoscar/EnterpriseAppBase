// =============================================================================
// PlatformHostModule: binds the DI-time host ports once (issue #696, PP-2.7)
// =============================================================================
//
// The app imports `PlatformHostModule.forRoot({...})` ONCE, in its root
// module (`apps/api/src/platform/platform-host.module.ts`). The module is
// global, so every packaged slice injects `AUDIT_SINK`, `SYSTEM_SETTINGS_STORE`
// or `PLATFORM_PRISMA` without importing anything of the app.
//
// Every port is optional. A slice that injects a port the app did not bind
// fails at boot with Nest's own missing-provider error, which names the token:
// loud, early and specific, the same failure a missing app provider gives.
// =============================================================================

import { DynamicModule, Module, ModuleMetadata, Provider } from '@nestjs/common';

import {
  AUDIT_SINK,
  AuditSink,
  PLATFORM_PRISMA,
  PortBinding,
  PrismaClientLike,
  SYSTEM_SETTINGS_STORE,
  SystemSettingsStore,
} from './ports';

/**
 * The app's adapters for the DI-time ports, plus the modules they need.
 *
 * @stability experimental
 */
export interface PlatformHostPorts {
  /** Binds {@link AUDIT_SINK}. */
  audit?: PortBinding<AuditSink>;
  /** Binds {@link SYSTEM_SETTINGS_STORE}. */
  settings?: PortBinding<SystemSettingsStore>;
  /** Binds {@link PLATFORM_PRISMA}. */
  prisma?: PortBinding<PrismaClientLike>;
  /**
   * Modules the adapters' own dependencies come from (a settings adapter that
   * injects the app's settings service needs that service's module). Global
   * modules (the app's Prisma module) need not be listed.
   */
  imports?: ModuleMetadata['imports'];
}

function toProvider(token: symbol, name: string, binding: unknown): Provider {
  const shape = binding as Record<string, unknown> | null;
  const kinds = shape && typeof shape === 'object' ? ['useExisting', 'useClass', 'useFactory'].filter((k) => k in shape) : [];
  if (kinds.length !== 1) {
    throw new Error(
      `PlatformHostModule.forRoot: the "${name}" port needs exactly one of useExisting, useClass or useFactory` +
        (kinds.length > 1 ? ` (got ${kinds.join(', ')})` : '') +
        '.',
    );
  }
  return { provide: token, ...(shape as object) } as Provider;
}

/**
 * Binds the platform's DI-time host ports to the app's adapters.
 *
 * @stability experimental
 */
@Module({})
export class PlatformHostModule {
  /**
   * Global. Binds the DI-time ports to the app's adapters. Each port is
   * optional; a slice that injects a missing port fails at boot with Nest's
   * missing-provider error naming the token.
   *
   * @param ports - one binding per port the app supplies, and the modules the
   *   adapters need.
   * @returns a global dynamic module exporting every bound token.
   * @throws Error when a binding names no provider shape, or more than one.
   *
   * @example
   * ```ts
   * PlatformHostModule.forRoot({
   *   audit: { useClass: PrismaAuditSink },
   *   settings: { useClass: SystemSettingsStoreAdapter },
   *   prisma: { useExisting: PrismaService },
   *   imports: [SettingsModule],
   * });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(ports: PlatformHostPorts = {}): DynamicModule {
    const providers: Provider[] = [];
    const exported: symbol[] = [];
    const bind = (token: symbol, name: string, binding: unknown) => {
      if (binding === undefined) return;
      providers.push(toProvider(token, name, binding));
      exported.push(token);
    };

    bind(AUDIT_SINK, 'audit', ports.audit);
    bind(SYSTEM_SETTINGS_STORE, 'settings', ports.settings);
    bind(PLATFORM_PRISMA, 'prisma', ports.prisma);

    return {
      global: true,
      module: PlatformHostModule,
      imports: ports.imports ?? [],
      providers,
      exports: exported,
    };
  }
}
