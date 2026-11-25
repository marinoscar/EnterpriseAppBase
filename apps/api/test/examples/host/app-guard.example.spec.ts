// =============================================================================
// PP-14.13 — an app-wide throttler, accepted by the host conformance suite
// =============================================================================
//
// The `host` suite fails an app that registers a global guard besides the
// maintenance guard (a global guard runs in front of every route, and a route
// without `@Auth()` is public). An app that wants one lists it in
// `allowedAppGuards`, naming the class and giving the reason in writing.
//
// This runs the REAL suite (`runPlatformConformance`) over a root module that
// imports the real `PlatformHostCoreModule.forRoot()` and the example throttler:
// once with the allowance (clean), and the unit checks around it (without it,
// an empty reason, a stale entry, the wrong order). Nothing is edited under
// `packages/`.
// =============================================================================

import { Module } from '@nestjs/common';
import { PlatformHostCoreModule } from '@marinoscar/platform-api/host';
import {
  checkHostModuleGraph,
  discoverHostModuleGraph,
  hostConformanceSuite,
} from '@marinoscar/platform-api/host/testing';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';

import { ExampleThrottlerGuard, ExampleThrottlerModule } from '../../../src/platform-extensions/host/example-throttler.guard';
import { API_SOURCE_ROOT } from '../../jobs/cron-source-roots';

const WHY = 'Global rate limit per client address; it authenticates nobody and reads nothing but the address.';

// The host core FIRST: global guards run in module order, and the maintenance
// window must be decided before the throttler counts anything.
@Module({ imports: [PlatformHostCoreModule.forRoot(), ExampleThrottlerModule] })
class RootWithThrottler {}

@Module({ imports: [ExampleThrottlerModule, PlatformHostCoreModule.forRoot()] })
class RootWithThrottlerFirst {}

// The suite itself, as an adopting app runs it: green only because of the allowance.
runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    host: {
      rootModule: RootWithThrottler,
      allowedAppGuards: [{ name: ExampleThrottlerGuard.name, why: WHY }],
    },
  },
});

describe('an app-wide guard next to MaintenanceGuard (PP-14.13)', () => {
  const walk = (root: Parameters<typeof discoverHostModuleGraph>[0], allowed?: Array<{ name: string; why: string }>) =>
    checkHostModuleGraph(discoverHostModuleGraph(root), allowed);

  it('is a finding without the allowance, naming the module and the option', () => {
    const findings = walk(RootWithThrottler);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('ExampleThrottlerModule registers APP_GUARD ExampleThrottlerGuard');
    expect(findings[0].message).toContain('allowedAppGuards');
  });

  it('is clean with the allowance', () => {
    expect(walk(RootWithThrottler, [{ name: 'ExampleThrottlerGuard', why: WHY }])).toEqual([]);
  });

  it('refuses an allowance with no written reason', () => {
    expect(() => walk(RootWithThrottler, [{ name: 'ExampleThrottlerGuard', why: '' }])).toThrow(/written `why`/);
    expect(() =>
      hostConformanceSuite.check({ sourceRoots: [] }, { rootModule: RootWithThrottler, allowedAppGuards: [{ name: 'ExampleThrottlerGuard', why: '  ' }] }),
    ).toThrow(/written `why`/);
  });

  it('keeps MaintenanceGuard first: a throttler imported ahead of the host core is a finding even when listed', () => {
    const findings = walk(RootWithThrottlerFirst, [{ name: 'ExampleThrottlerGuard', why: WHY }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('before MaintenanceGuard');
  });

  it('flags an allowance for a guard nobody registers any more', () => {
    @Module({ imports: [PlatformHostCoreModule.forRoot()] })
    class RootWithoutThrottler {}
    const findings = walk(RootWithoutThrottler, [{ name: 'ExampleThrottlerGuard', why: WHY }]);
    expect(findings).toHaveLength(1);
    expect(findings[0].message).toContain('remove the stale entry');
  });

  it('throttles per client address, and leaves the maintenance decision to run before it', () => {
    const guard = new ExampleThrottlerGuard();
    const context = (ip: string) =>
      ({ getType: () => 'http', switchToHttp: () => ({ getRequest: () => ({ ip }) }) }) as never;
    for (let i = 0; i < 100; i += 1) expect(guard.canActivate(context('203.0.113.1'))).toBe(true);
    expect(() => guard.canActivate(context('203.0.113.1'))).toThrow(/Too many requests/);
    expect(guard.canActivate(context('203.0.113.2'))).toBe(true);
  });
});
