// The runner's globals as a ConformanceTestApi (PP-14.26). Shared by every
// extension-author kit (`describeDoctorCheckConformance`,
// `describeJobHandlerConformance`): they take an optional `testApi` and fall
// back to the runner they run under. Imports no test runner.

import type { ConformanceTestApi } from './conformance-suite';

/**
 * The test API a kit registers its tests on: the one the caller injected, else
 * the runner's own globals (`describe`, `it`, `expect` of Jest, or of Vitest
 * with `globals: true`).
 *
 * @param kit - the kit's name, for the error message (`describeDoctorCheckConformance`).
 * @param testApi - an injected API (a recording fake in a package test); omitted, the globals are used.
 * @returns the API to register on.
 * @throws Error when no API was injected and the runner has no global `describe`, `it` and `expect`.
 *
 * @stability experimental
 */
export function resolveConformanceTestApi(kit: string, testApi?: ConformanceTestApi): ConformanceTestApi {
  if (testApi) return testApi;
  const g = globalThis as unknown as Partial<ConformanceTestApi>;
  if (typeof g.describe !== 'function' || typeof g.it !== 'function' || typeof g.expect !== 'function') {
    throw new Error(`${kit}: no global describe/it/expect. Run it under Jest, under Vitest with \`globals: true\`, or pass \`testApi\`.`);
  }
  return { describe: g.describe, it: g.it, expect: g.expect };
}
