// =============================================================================
// The host core's invariants, run against the reference app (issue #867)
// =============================================================================
//
// The `host` suite of `@marinoscar/platform-api/host/testing` walks the whole
// module graph from `AppModule`: the maintenance guard is the first `APP_GUARD`
// and the app lists no other (CLAUDE.md, architecture principle 3: there is no
// global JWT guard, so a route without `@Auth()` is public; an app that adds a
// global guard names it in `allowedAppGuards` with a reason, see
// `test/examples/host/app-guard.example.spec.ts`); `PlatformHostCoreModule`
// imported once; the `{ data }` envelope and the exception filter global, once
// each. It replaces the old `maintenance.module.spec.ts` pin on `AppModule`'s
// own providers, which a guard registered by a packaged module would slip past.
// =============================================================================

import '@marinoscar/platform-api/host/testing';

import { runPlatformConformance } from '@marinoscar/platform-api/testing';

import { AppModule } from '../../src/app.module';
import { API_SOURCE_ROOT } from '../jobs/cron-source-roots';

runPlatformConformance({
  sourceRoots: [API_SOURCE_ROOT],
  suites: {
    // No `allowedAppGuards`: the reference app registers no global guard of its own.
    host: { rootModule: AppModule },
  },
});
