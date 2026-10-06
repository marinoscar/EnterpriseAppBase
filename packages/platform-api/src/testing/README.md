# testing

`@marinoscar/platform-api/testing`: the conformance harness. An app runs the platform's invariants through one call, `runPlatformConformance()`, and supplies only its own data. First suite: `cron-enqueue-only`.

## Purpose and scope

The base enforces its invariants with tripwire tests. If those tests stayed in the platform repository, an app would silently stop being checked once it consumed a package. So the scan ships here, and the app's spec shrinks to its data (exemptions, minimums).

Does: scan the app's source tree, register one `describe` block per enabled suite, make an opt-out visible, refuse an unknown suite key.
Does not: depend on Jest or Vitest (it takes a minimal test API, defaulting to the globals), change what a rule accepts, or hold an app's exemptions.

## Install and peer dependencies

```bash
npm install --save-dev @marinoscar/platform-api
```

Peers are those of the package ([README](../../README.md#peer-dependencies)); the slice itself needs only Node. It imports the `core` slice for its suite registry. Jest resolves the subpath through the package `exports`, so build the packages first (`npm run build:packages`).

## Quick start

```ts
// apps/api/test/jobs/cron-enqueue-only.spec.ts
import { join } from 'node:path';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';

runPlatformConformance({
  sourceRoots: [join(__dirname, '..', '..', 'src')],
  suites: { cronEnqueueOnly: { exempt: EXEMPT, minCronFiles: 8 } },
});
```

`EXEMPT` is `ReadonlyArray<{ file: string; why: string }>`; the reference app's three entries, each argued, are in the example above.

## Configuration

`PlatformConformanceOptions`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `sourceRoots` | `readonly string[]` | required | Absolute directories with the app's non-test TypeScript. Never empty. |
| `suites` | `{ cronEnqueueOnly?: CronEnqueueOnlyOptions \| false }` | required | A suite's options runs it; `false` opts out (visibly); an omitted key does not run; an unknown key throws. |
| `testApi` | `ConformanceTestApi` | the globals `describe`/`it`/`expect` | Inject a runner, or a recording fake in tests. |

`CronEnqueueOnlyOptions`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `exempt` | `Array<{ file, why }>` | required | Files allowed to work inline, relative to the source root, `/` separators. `why` needs more than 40 characters; the file must hold a `@Cron`. |
| `minCronFiles` | `number` | required | Vacuity guard: at least this many files with a `@Cron` must be found. A positive integer. |
| `extraWorkMarkers` | `Array<{ pattern: RegExp, what: string }>` | `[]` | Additive markers for the app's own work helpers. The platform markers always apply. |

## Extension-point catalog

| Export | Kind | Stability | Use it to |
|---|---|---|---|
| `runPlatformConformance(options)` | option (`@extensionPoint option`) | experimental | Register the enabled suites at the top level of a spec file. |
| `PlatformConformanceOptions`, `CronEnqueueOnlyOptions` | option types | experimental | Configure the run and the cron suite. |
| `conformanceSuites` | registry (`@extensionPoint registry`) | experimental | The suites the runner can run, frozen on the first run. A later suite is one `register()` in `conformance-suites.ts`; the runner is not edited. |
| `ConformanceSuite<TOptions>` | registry entry type | experimental | Write a suite: `id`, `title`, `description`, a pure `check()` and its `cases()`. |
| `ConformanceTestApi`, `ConformanceReport`, `ConformanceFinding`, `ConformanceCase`, `ConformanceContext` | types | experimental | The contract between harness and suite. |
| `cronEnqueueOnlySuite` | suite | experimental | The registered cron suite, for direct `check()` calls in tests. |

Working example: [`apps/api/test/jobs/cron-enqueue-only.spec.ts`](../../../../apps/api/test/jobs/cron-enqueue-only.spec.ts).

## Data

None.

## Permissions and settings

None.

## UI

None.

## Infra

None. No environment variables. In CI the packages must be built before the app's Jest run (`npm run build:packages`; every job in `ci.yml` does it).

## Observability

None at runtime: this is test tooling. A failing suite names the file and the marker (`<file>: a @Cron body containing a bulk delete`).

## Security notes

The suite is a tripwire on the shape of a cron body; it does not follow calls into helpers, so a helper's own spec must pin that it only enqueues. Two limits are kept from the original scan and pinned by tests: braces inside comments and strings count toward brace matching, and a decorator options object (`@Cron('...', { name })`) is read as the body, which is reported as "queues nothing" (it fails loudly, never passes silently). The rule itself is unchanged: same ten markers, same enqueue pattern.

## Conformance suite

This slice is the harness. Suites it runs today:

| Suite id | Option key | Enforces |
|---|---|---|
| `cron-enqueue-only` | `cronEnqueueOnly` | Every `@Cron` body enqueues a job and contains none of the ten markers of inline work, except the app's argued exemptions. Generates three tests: finds the crons at all; exempts `<file>`, on the record (per exemption); queues its work instead of doing it. |

Planned, joining the same entry point (#742): the `@OnEvent` no-I/O counterpart (`test/jobs/on-event-no-io.spec.ts`), the AI kill switch, RBAC matrix, secret egress, key policy, jobs server-only and no-SDK-leak suites, and the settings registries.

## Upgrade notes

None (first release).

## Troubleshooting

| Symptom | Cause |
|---|---|
| `Cannot find module '@marinoscar/platform-api/testing'` | The package is not built. Run `npm run build:packages`. |
| `unknown conformance suite "x"` | A typo in `suites`, or the suite is not registered yet. |
| `no global describe/it/expect` | Not running under Jest or Vitest with `globals: true`; pass `testApi`. |
| The vacuity test fails | Fewer than `minCronFiles` files with a `@Cron` were found: a wrong `sourceRoots`, or the tasks moved. |
| `exempts <file>` fails | The file holds no `@Cron` (a stale exemption), or `why` is 40 characters or fewer. |
| `cannot read source root` | `sourceRoots` holds a path that does not exist. |

## Links

- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md), "Conformance suites travel with packages" and "The Extension Contract" (guardrails).
- The rule: [job-queue.md](../../../../docs/specs/job-queue.md), "All long-running work is a job".
- How tests are organised: [TESTING.md](../../../../docs/TESTING.md#conformance-suites-in-packages).
- Package README: [platform-api](../../README.md).
