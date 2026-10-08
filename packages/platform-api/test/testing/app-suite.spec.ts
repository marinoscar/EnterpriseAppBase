import { conformanceSuites, runPlatformConformance } from '../../src/testing';
import type { ConformanceAppSuite } from '../../src/testing';
import { emptySourceRoot, outcome, recordingTestApi } from '../support/conformance-harness';

interface FixtureOptions {
  greeting: string;
}

// Registered before the first run: the registry freezes when `runPlatformConformance` first runs.
const fixtureAppSuite: ConformanceAppSuite<FixtureOptions> = {
  id: 'fixture-app-suite',
  title: 'a suite that registers its own tree',
  description: 'Fixture for the app-suite path of the harness.',
  register(api, context, options) {
    api.describe('a suite that registers its own tree', () => {
      api.it(`greets with ${options.greeting} over ${context.sourceRoots.length} root(s)`, () => undefined);
    });
  },
};

conformanceSuites.register(fixtureAppSuite);

describe('runPlatformConformance with a suite that registers its own tree', () => {
  it('calls register with the context and the app options, and lists the suite as run', async () => {
    const { api, tests, titles } = recordingTestApi();
    const written: string[] = [];
    const write = jest.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      written.push(String(chunk));
      return true;
    });

    try {
      runPlatformConformance({
        sourceRoots: [emptySourceRoot()],
        suites: { fixtureAppSuite: { greeting: 'hello' } } as never,
        testApi: api,
      });
      for (const test of tests) expect(await outcome(test)).toBeNull();
    } finally {
      write.mockRestore();
    }

    expect(titles).toEqual(['a suite that registers its own tree', 'platform conformance: suites run and skipped']);
    expect(tests[0]!.name).toBe('a suite that registers its own tree > greets with hello over 1 root(s)');
    expect(written.join('')).toContain('fixture-app-suite  run');
  });

  it('lets the app skip it with a reason, like any other suite', () => {
    const { api, tests } = recordingTestApi();

    runPlatformConformance({
      sourceRoots: [emptySourceRoot()],
      suites: { fixtureAppSuite: { skip: 'No AI in this app.' } } as never,
      testApi: api,
    });

    expect(tests[0]!.name).toBe('a suite that registers its own tree > fixture-app-suite: skipped by the app (No AI in this app.)');
  });
});
