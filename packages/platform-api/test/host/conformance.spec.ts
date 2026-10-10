// The host conformance suite (#867) finds what it promises to.
import 'reflect-metadata';

import { Module, type CanActivate } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';

import { conformanceSuites } from '../../src/testing/index';
import { PlatformHostCoreModule } from '../../src/host/index';
import { checkHostModuleGraph, discoverHostModuleGraph, hostConformanceSuite } from '../../src/host/testing/index';

class GlobalJwtGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

class AnotherEnvelope {}

describe('host conformance suite', () => {
  it('registers itself with the harness on import', () => {
    expect(conformanceSuites.has('host')).toBe(true);
    expect(hostConformanceSuite.id).toBe('host');
  });

  it('passes an app that imports the host core once and adds no global guard', () => {
    @Module({ imports: [PlatformHostCoreModule.forRoot()] })
    class App {}
    expect(checkHostModuleGraph(discoverHostModuleGraph(App))).toEqual([]);
  });

  it('fails an app with no host core: no maintenance guard, no envelope, no filter', () => {
    @Module({})
    class Bare {}
    expect(checkHostModuleGraph(discoverHostModuleGraph(Bare)).map((f) => f.file)).toEqual([
      'app-guard',
      'host-core',
      'envelope',
      'envelope',
    ]);
  });

  it('fails a global JWT guard anywhere in the graph, naming the module', () => {
    @Module({ providers: [{ provide: APP_GUARD, useClass: GlobalJwtGuard }] })
    class Feature {}
    @Module({ imports: [PlatformHostCoreModule.forRoot(), Feature] })
    class App {}
    const findings = checkHostModuleGraph(discoverHostModuleGraph(App));
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({ file: 'app-guard' });
    expect(findings[0].message).toContain('Feature registers APP_GUARD GlobalJwtGuard');
  });

  it('ignores an unrelated interceptor but not a missing envelope', () => {
    @Module({ imports: [PlatformHostCoreModule.forRoot()], providers: [{ provide: APP_INTERCEPTOR, useClass: AnotherEnvelope }] })
    class App {}
    expect(checkHostModuleGraph(discoverHostModuleGraph(App))).toEqual([]);
  });

  it('reports what it walked', () => {
    @Module({ imports: [PlatformHostCoreModule.forRoot()] })
    class App {}
    const report = hostConformanceSuite.check({ sourceRoots: [] }, { rootModule: App });
    expect(report.scannedFiles.modules).toEqual(expect.arrayContaining(['App', 'PlatformHostCoreModule', 'OtelMetricsModule', 'JwtModule']));
    expect(report.scanned.globalEnhancers).toBe(4);
    expect(hostConformanceSuite.cases({ rootModule: App }).map((c) => c.name.split(':')[0])).toEqual(['app-guard', 'host-core', 'envelope']);
  });
});
