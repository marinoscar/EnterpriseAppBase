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

  describe('allowedAppGuards (PP-14.13)', () => {
    class Throttler {}
    class TenantGuard {}

    const appWith = (providers: Array<{ provide: unknown; useClass: unknown }>) => {
      @Module({ providers: providers as never })
      class Feature {}
      @Module({ imports: [PlatformHostCoreModule.forRoot(), Feature] })
      class App {}
      return App;
    };
    const check = (root: ReturnType<typeof appWith>, allowed?: Array<{ name: string; why: string }>) =>
      checkHostModuleGraph(discoverHostModuleGraph(root), allowed);

    it('accepts an app guard the app lists with a reason, and rejects it otherwise', () => {
      const App = appWith([{ provide: APP_GUARD, useClass: Throttler }]);
      expect(check(App, [{ name: 'Throttler', why: 'Global rate limit; runs after the maintenance window decision.' }])).toEqual([]);
      const findings = check(App);
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toContain('Feature registers APP_GUARD Throttler');
      expect(findings[0].message).toContain('allowedAppGuards');
    });

    it('accepts several listed guards but still flags an unlisted one', () => {
      const App = appWith([
        { provide: APP_GUARD, useClass: Throttler },
        { provide: APP_GUARD, useClass: TenantGuard },
      ]);
      expect(check(App, [{ name: 'Throttler', why: 'rate limit' }])).toHaveLength(1);
      expect(check(App, [{ name: 'Throttler', why: 'rate limit' }, { name: 'TenantGuard', why: 'tenant scoping' }])).toEqual([]);
    });

    it.each([[''], ['   '], [undefined as unknown as string]])('throws for an entry with the reason %p', (why) => {
      const App = appWith([{ provide: APP_GUARD, useClass: Throttler }]);
      expect(() => check(App, [{ name: 'Throttler', why }])).toThrow(/needs a written `why`/);
    });

    it('throws for an entry with no name', () => {
      expect(() => check(appWith([]), [{ name: ' ', why: 'x' }])).toThrow(/class name/);
    });

    it('flags a stale entry that matches no registered guard', () => {
      const findings = check(appWith([]), [{ name: 'Throttler', why: 'rate limit' }]);
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toContain('lists Throttler, but no module registers it');
    });

    it('does not let an allowed guard stand in for MaintenanceGuard', () => {
      @Module({ providers: [{ provide: APP_GUARD, useClass: Throttler }] })
      class OnlyThrottler {}
      const findings = checkHostModuleGraph(discoverHostModuleGraph(OnlyThrottler), [{ name: 'Throttler', why: 'rate limit' }]);
      expect(findings.map((f) => f.file)).toContain('app-guard');
      expect(findings.some((f) => f.message.includes('MaintenanceGuard is registered as APP_GUARD 0 time(s)'))).toBe(true);
    });

    it('requires MaintenanceGuard to be the FIRST global guard, even for a listed one', () => {
      @Module({ providers: [{ provide: APP_GUARD, useClass: Throttler }] })
      class EarlyFeature {}
      @Module({ imports: [EarlyFeature, PlatformHostCoreModule.forRoot()] })
      class App {}
      const findings = checkHostModuleGraph(discoverHostModuleGraph(App), [{ name: 'Throttler', why: 'rate limit' }]);
      expect(findings).toHaveLength(1);
      expect(findings[0].message).toContain('registers APP_GUARD Throttler before MaintenanceGuard');
    });

    it('is wired through the suite option', () => {
      const App = appWith([{ provide: APP_GUARD, useClass: Throttler }]);
      expect(hostConformanceSuite.check({ sourceRoots: [] }, { rootModule: App }).findings).toHaveLength(1);
      expect(
        hostConformanceSuite.check({ sourceRoots: [] }, { rootModule: App, allowedAppGuards: [{ name: 'Throttler', why: 'rate limit' }] }).findings,
      ).toEqual([]);
      expect(() => hostConformanceSuite.check({ sourceRoots: [] }, { rootModule: App, allowedAppGuards: [{ name: 'Throttler', why: '' }] })).toThrow();
    });
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
