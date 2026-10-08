// =============================================================================
// The host slice's conformance suite (issue #867)
// =============================================================================
//
// Importing `@marinoscar/platform-api/host/testing` registers it with
// `runPlatformConformance` (suite id `host`, option key `host`). A static walk
// of the app's module graph, from its root module, with no database and no
// boot:
//
//   1. the graph registers EXACTLY ONE `APP_GUARD`, and it is
//      `MaintenanceGuard`: there is no global JWT guard, so a route without
//      `@Auth()` is public (CLAUDE.md, architecture principle 3) and the
//      maintenance window applies to every Nest route;
//   2. `PlatformHostCoreModule.forRoot()` is imported exactly once (one event
//      bus per process: two would each treat the other's messages as remote);
//   3. the `{ data }` envelope (`TransformInterceptor`) and core's
//      `HttpExceptionFilter` are global enhancers, each registered once.
// =============================================================================

import { MODULE_METADATA } from '@nestjs/common/constants';
import type { DynamicModule, ForwardReference, Provider, Type } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { HttpExceptionFilter } from '../../core/index';
import { conformanceSuites } from '../../testing/index';
import type { ConformanceCase, ConformanceFinding, ConformanceReport, ConformanceSuite } from '../../testing/index';
import { PlatformHostCoreModule } from '../host-core.module';
import { TransformInterceptor } from '../http/transform.interceptor';
import { MaintenanceGuard } from '../maintenance/maintenance.guard';

declare module '../../testing/index' {
  interface PlatformConformanceSuiteOptions {
    /** The host slice's suite: its options. Registered by importing `@marinoscar/platform-api/host/testing`. */
    host?: HostConformanceOptions;
  }
}

/**
 * Options of the `host` suite.
 *
 * @stability experimental
 */
export interface HostConformanceOptions {
  /** The app's root module; every module reachable from it is walked. */
  readonly rootModule: Type<unknown> | DynamicModule;
}

/**
 * One global enhancer provider the walk found.
 *
 * @stability experimental
 */
export interface HostGlobalEnhancer {
  /** `APP_GUARD`, `APP_FILTER`, `APP_INTERCEPTOR` or `APP_PIPE`, as a string. */
  readonly token: string;
  /** The class it resolves to (`useClass` or `useExisting`), when it names one. */
  readonly target: unknown;
  /** The module that provides it. */
  readonly module: string;
}

/**
 * What the walk of the module graph found.
 *
 * @stability experimental
 */
export interface HostModuleGraph {
  /** Every module reachable from the root, by class name, in discovery order. */
  readonly modules: readonly string[];
  /** Every `APP_*` provider of those modules. */
  readonly enhancers: readonly HostGlobalEnhancer[];
  /** How many times `PlatformHostCoreModule` appears (dynamic module entries). */
  readonly hostCoreImports: number;
}

type ImportLike = Type<unknown> | DynamicModule | Promise<DynamicModule> | ForwardReference;

const ENHANCER_TOKENS = new Map<unknown, string>([
  [APP_GUARD, 'APP_GUARD'],
  [APP_FILTER, 'APP_FILTER'],
  [APP_INTERCEPTOR, 'APP_INTERCEPTOR'],
  ['APP_PIPE', 'APP_PIPE'],
]);

function isDynamic(value: unknown): value is DynamicModule {
  return typeof value === 'object' && value !== null && 'module' in value;
}

function isForwardRef(value: unknown): value is ForwardReference {
  return typeof value === 'object' && value !== null && 'forwardRef' in value;
}

function nameOf(value: unknown): string {
  return typeof value === 'function' ? (value as { name: string }).name : String(value);
}

/**
 * Walks the module graph from `root` (static metadata and dynamic modules),
 * collecting every module and every global enhancer provider.
 *
 * @param root - the app's root module.
 * @returns what the walk found.
 *
 * @stability experimental
 */
export function discoverHostModuleGraph(root: Type<unknown> | DynamicModule): HostModuleGraph {
  const seen = new Set<unknown>();
  const modules: string[] = [];
  const enhancers: HostGlobalEnhancer[] = [];
  let hostCoreImports = 0;

  const visit = (entry: ImportLike | undefined): void => {
    if (!entry || entry instanceof Promise) return;
    const resolved = isForwardRef(entry) ? (entry.forwardRef() as ImportLike) : entry;
    if (seen.has(resolved)) return;
    seen.add(resolved);
    const moduleClass = isDynamic(resolved) ? resolved.module : (resolved as Type<unknown>);
    if (moduleClass === PlatformHostCoreModule && isDynamic(resolved)) hostCoreImports += 1;
    modules.push(nameOf(moduleClass));

    const providers = [
      ...((Reflect.getMetadata(MODULE_METADATA.PROVIDERS, moduleClass) ?? []) as Provider[]),
      ...(isDynamic(resolved) ? resolved.providers ?? [] : []),
    ];
    for (const provider of providers) {
      if (typeof provider !== 'object' || provider === null || !('provide' in provider)) continue;
      const token = ENHANCER_TOKENS.get(provider.provide);
      if (!token) continue;
      const shape = provider as { useClass?: unknown; useExisting?: unknown };
      enhancers.push({ token, target: shape.useClass ?? shape.useExisting, module: nameOf(moduleClass) });
    }

    const imports = [
      ...((Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleClass) ?? []) as ImportLike[]),
      ...((isDynamic(resolved) ? resolved.imports ?? [] : []) as ImportLike[]),
    ];
    for (const child of imports) visit(child);
  };

  visit(root);
  return { modules, enhancers, hostCoreImports };
}

/**
 * The findings of the walk: one global guard and it is `MaintenanceGuard`,
 * one host core, the envelope and the exception filter registered once.
 *
 * @param graph - what {@link discoverHostModuleGraph} found.
 * @returns one finding per violation.
 *
 * @stability experimental
 */
export function checkHostModuleGraph(graph: HostModuleGraph): ConformanceFinding[] {
  const findings: ConformanceFinding[] = [];
  const of = (token: string) => graph.enhancers.filter((enhancer) => enhancer.token === token);

  const guards = of('APP_GUARD');
  for (const guard of guards) {
    if (guard.target !== MaintenanceGuard) {
      findings.push({
        file: 'app-guard',
        message: `${guard.module} registers APP_GUARD ${nameOf(guard.target)}: the only global guard is MaintenanceGuard (there is no global JWT guard; a route declares @Auth() or @Public())`,
      });
    }
  }
  if (guards.filter((guard) => guard.target === MaintenanceGuard).length !== 1) {
    findings.push({
      file: 'app-guard',
      message: `MaintenanceGuard is registered as APP_GUARD ${guards.filter((guard) => guard.target === MaintenanceGuard).length} time(s), expected exactly once (PlatformHostCoreModule.forRoot())`,
    });
  }

  if (graph.hostCoreImports !== 1) {
    findings.push({
      file: 'host-core',
      message: `PlatformHostCoreModule.forRoot() is imported ${graph.hostCoreImports} time(s), expected exactly once (one event bus per process)`,
    });
  }

  const envelopes = of('APP_INTERCEPTOR').filter((enhancer) => enhancer.target === TransformInterceptor);
  if (envelopes.length !== 1) {
    findings.push({ file: 'envelope', message: `TransformInterceptor is a global interceptor ${envelopes.length} time(s), expected exactly once: every JSON body is { data, meta }` });
  }
  const filters = of('APP_FILTER').filter((enhancer) => enhancer.target === HttpExceptionFilter);
  if (filters.length !== 1) {
    findings.push({ file: 'envelope', message: `HttpExceptionFilter is a global filter ${filters.length} time(s), expected exactly once: every error has the six-key body` });
  }
  return findings;
}

/**
 * The `host` conformance suite. Registered when
 * `@marinoscar/platform-api/host/testing` is imported.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const hostConformanceSuite: ConformanceSuite<HostConformanceOptions> = {
  id: 'host',
  title: 'the host core keeps its invariants',
  description:
    'Exactly one APP_GUARD and it is MaintenanceGuard (no global JWT guard), one PlatformHostCoreModule, and the { data } envelope and exception filter registered once.',
  check(_context, options): ConformanceReport {
    const graph = discoverHostModuleGraph(options.rootModule);
    return {
      scanned: { modules: graph.modules.length, globalEnhancers: graph.enhancers.length },
      scannedFiles: { modules: graph.modules },
      findings: checkHostModuleGraph(graph),
    };
  },
  cases(): ConformanceCase[] {
    return [
      {
        name: 'app-guard: the only APP_GUARD is MaintenanceGuard (no global JWT guard)',
        run: (report, expect) => {
          expect(report.findings.filter((finding) => finding.file === 'app-guard')).toEqual([]);
        },
      },
      {
        name: 'host-core: PlatformHostCoreModule.forRoot() is imported exactly once',
        run: (report, expect) => {
          expect(report.findings.filter((finding) => finding.file === 'host-core')).toEqual([]);
        },
      },
      {
        name: 'envelope: the { data } interceptor and the exception filter are global, once each',
        run: (report, expect) => {
          expect(report.findings.filter((finding) => finding.file === 'envelope')).toEqual([]);
        },
      },
    ];
  },
};

if (!conformanceSuites.has(hostConformanceSuite.id)) conformanceSuites.register(hostConformanceSuite);
