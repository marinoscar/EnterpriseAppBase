// =============================================================================
// Every job handler the reference app registers honours the handler contract
// (PP-14.26)
// =============================================================================
//
// `findJobHandlerContractViolations` (`@marinoscar/platform-api/jobs/testing`) is
// the static half of `describeJobHandlerConformance`: a dotted permanent type, a
// label, a profile of exactly `{ maxRuntimeMs, maxAttempts }` inside sane bounds,
// node eligibility DERIVED from `nodeResultSchema` + `persistNodeResult` (both or
// neither), and `ai.*` types server-only. This spec runs it over every handler the
// booted `JobHandlerRegistry` holds, so a handler added tomorrow is covered with no
// edit. Behavioural proof (a double run, a failing payload) is per handler, in the
// handler's own spec through `describeJobHandlerConformance`.
//
// The one handler without a label is pinned in `job-type-snapshot.spec.ts`
// (`UNLABELLED_JOB_TYPES`); it is named here too, so giving it a label is a change to
// both lists.
// =============================================================================

import { JobHandlerRegistry } from '@marinoscar/platform-api/jobs';
import { findJobHandlerContractViolations } from '@marinoscar/platform-api/jobs/testing';

import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';

/** Registered without a label of their own; the admin list shows the type string. */
const UNLABELLED: ReadonlySet<string> = new Set(['sharing.grants.prune']);

describe('the reference app’s job handlers honour the handler contract', () => {
  let context: TestContext;
  let registry: JobHandlerRegistry;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
    registry = context.app.get(JobHandlerRegistry);
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
  });

  it('finds the handlers at all, so a broken discovery cannot pass vacuously', () => {
    expect(registry.types().length).toBeGreaterThanOrEqual(30);
  });

  it('every registered handler passes the static contract', () => {
    const problems = registry
      .types()
      .flatMap((type) => findJobHandlerContractViolations(registry.get(type)!, { allowUnlabelled: UNLABELLED.has(type) }));

    expect(problems).toEqual([]);
  });

  it('names no handler in the unlabelled list that is gone or has gained a label', () => {
    const stale = [...UNLABELLED].filter((type) => {
      const handler = registry.get(type);
      return !handler || (typeof handler.label === 'string' && handler.label.trim() !== '');
    });

    expect(stale).toEqual([]);
  });
});
