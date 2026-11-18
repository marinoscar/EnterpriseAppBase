import { runPlatformConformance } from '../../../src/testing';
import { conformanceSuites } from '../../../src/testing';
// Importing the AI testing entry registers its suites; the jobs entry registers the listener one.
import '../../../src/ai/testing';
import '../../../src/jobs/testing';
import { emptySourceRoot, outcome, recordingTestApi, removeSourceRoots } from '../../support/conformance-harness';

afterAll(removeSourceRoots);

const AI_SUITES = [
  'ai-kill-switch',
  'ai-rbac-matrix',
  'ai-secret-egress',
  'ai-key-policy',
  'ai-jobs-server-only',
  'ai-no-sdk-leak',
  'ai-orchestration-boundary',
];

describe('the AI and jobs testing entries register their suites', () => {
  it('registers each suite id once, next to the harness’s own', () => {
    runPlatformConformance({ sourceRoots: [emptySourceRoot()], suites: {}, testApi: recordingTestApi().api });

    expect(conformanceSuites.ids()).toEqual(
      expect.arrayContaining(['cron-enqueue-only', 'user-owned-data', 'on-event-no-io', ...AI_SUITES]),
    );
    expect(conformanceSuites.ids().filter((id) => AI_SUITES.includes(id))).toHaveLength(AI_SUITES.length);
  });

  it.each(AI_SUITES)('lets an app skip %s with a reason, and refuses a skip without one', async (id) => {
    const key = id.replace(/-([a-z0-9])/g, (_m, c: string) => c.toUpperCase());
    const { api, tests } = recordingTestApi();

    runPlatformConformance({
      sourceRoots: [emptySourceRoot()],
      suites: { [key]: { skip: 'This fixture app has no AI.' } } as never,
      testApi: api,
    });

    expect(tests[0]!.name).toContain(`${id}: skipped by the app (This fixture app has no AI.)`);
    expect(await outcome(tests[0]!)).toBeNull();
    expect(() =>
      runPlatformConformance({ sourceRoots: [emptySourceRoot()], suites: { [key]: { skip: '' } } as never, testApi: recordingTestApi().api }),
    ).toThrow('skipped without a reason');
  });
});
