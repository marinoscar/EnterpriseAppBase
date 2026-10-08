// =============================================================================
// The host core's invariants, run against the reference app (issue #867)
// =============================================================================
//
// The `host` suite of `@marinoscar/platform-api/host/testing` walks the whole
// module graph from `AppModule`: exactly one `APP_GUARD`, and it is the
// maintenance guard (CLAUDE.md, architecture principle 3: there is no global
// JWT guard, so a route without `@Auth()` is public); `PlatformHostCoreModule`
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
    host: { rootModule: AppModule },
  },
});
