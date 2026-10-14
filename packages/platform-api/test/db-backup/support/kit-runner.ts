// Runs a conformance kit's cases outside any test runner and reports which
// passed. A kit that cannot FAIL is a kit that proves nothing, so the specs run
// each kit against a deliberately broken target or gate as well as a good one.

export interface KitResult {
  /** Case name -> `null` when it passed, the failure message otherwise. */
  results: Map<string, string | null>;
  failed(): string[];
  passed(): string[];
}

export async function runKit(
  register: (harness: {
    describe: (name: string, fn: () => void) => unknown;
    it: (name: string, fn: () => Promise<void>) => unknown;
    expect: (actual: unknown) => any;
  }) => void,
  expectFn: (actual: unknown) => any,
): Promise<KitResult> {
  const cases: Array<{ name: string; fn: () => Promise<void> }> = [];

  register({
    describe: (_name, fn) => {
      fn();
    },
    it: (name, fn) => {
      cases.push({ name, fn });
    },
    expect: expectFn,
  });

  const results = new Map<string, string | null>();
  for (const { name, fn } of cases) {
    try {
      await fn();
      results.set(name, null);
    } catch (error) {
      results.set(name, error instanceof Error ? error.message : String(error));
    }
  }

  return {
    results,
    failed: () => [...results].filter(([, message]) => message !== null).map(([name]) => name),
    passed: () => [...results].filter(([, message]) => message === null).map(([name]) => name),
  };
}
