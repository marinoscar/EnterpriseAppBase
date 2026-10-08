# @marinoscar/platform-api/testing

`@marinoscar/platform-api/testing`: the conformance harness. An app runs the platform's invariants through one call, `runPlatformConformance()`, and supplies only its own data. This slice ships `cron-enqueue-only` and `user-owned-data`; each slice that has invariants ships its own suites in its `testing` entry (the [table below](#conformance-suite) lists every suite id of the platform, API and web).

## Purpose and scope

The base enforces its invariants with tripwire tests. If those tests stayed in the platform repository, an app would silently stop being checked once it consumed a package. So the scan ships here, and the app's spec shrinks to its data (exemptions, minimums).

Does: scan the app's source tree (and, for `user-owned-data`, its Prisma schema), register one `describe` block per enabled suite (a suite either scans once and asserts on its report, or, when it has to boot the app, registers its own tree), make an opt-out visible and require its reason (`{ skip: 'reason' }`; an empty reason throws), print a summary table of the suites run and skipped, refuse an unknown suite key.
Does not: depend on Jest or Vitest (it takes a minimal test API, defaulting to the globals), change what a rule accepts, or hold an app's exemptions.

It also holds the **host-port test doubles** (#696), for package tests: `createTestPlatformHost()` (access decorators driven by an `x-test-permissions` request header: no header is 401, a missing permission 403; never for apps), `InMemoryAuditSink` and `InMemorySystemSettingsStore` (one document version, a `ConflictException` on a stale `ifMatchVersion`), plus the constants `TEST_PERMISSIONS_HEADER` and `TEST_REQUIRED_PERMISSIONS_KEY`. See the [core README](../core/README.md#test-doubles).

## Install and peer dependencies

```bash
npm install --save-dev @marinoscar/platform-api
```

Peers are those of the package ([README](../../README.md#peer-dependencies)); the slice itself needs only Node. It imports the `core` slice for its suite registry and, for `user-owned-data`, for `ownerRelationOf` and the `UserOwnedModelDef` type (so loading it loads core's `@prisma/client/extension` and `@opentelemetry/api` peers). The Prisma schema is parsed by a small reader in this slice (`readSchemaDatamodel`), never by `@prisma/internals`. Jest resolves the subpath through the package `exports`, so build the packages first (`npm run build:packages`).

## Quick start

```ts
// apps/api/test/conformance.spec.ts
import { join } from 'node:path';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';

runPlatformConformance({
  sourceRoots: [join(__dirname, '..', '..', 'src')],
  suites: {
    cronEnqueueOnly: { exempt: EXEMPT, minCronFiles: 8 },
    // A slice's suite is available once its testing entry is imported
    // (`import '@marinoscar/platform-api/jobs/testing'`), and is opted out with a reason:
    aiKillSwitch: { skip: 'This app does not ship the AI slice.' },
  },
});
```

The reference app's whole entry, with every suite of the platform, is [`apps/api/test/conformance.spec.ts`](../../../../apps/api/test/conformance.spec.ts); the AI suites also take the small fixture that describes how it boots ([`apps/api/test/conformance/ai-fixture.ts`](../../../../apps/api/test/conformance/ai-fixture.ts)). `EXEMPT` is `ReadonlyArray<{ file: string; why: string }>`; the reference app's three entries, each argued, are in the example above.

```ts
// apps/api/test/prisma/user-owned-models.spec.ts
import { userOwnedModelRegistry } from '@marinoscar/platform-api/core';
import { runPlatformConformance } from '@marinoscar/platform-api/testing';
import '../../src/prisma/ownership'; // fills the registry: platform inventory, then the app's
import { RAW_SQL_ALLOWLIST } from './raw-sql-allowlist';

runPlatformConformance({
  sourceRoots: [join(__dirname, '..', '..', 'src')],
  suites: {
    userOwnedData: {
      schemaPath: join(__dirname, '..', '..', 'prisma', 'schema'),
      policies: userOwnedModelRegistry.list(),
      rawSqlAllowlist: RAW_SQL_ALLOWLIST,
      registerIn: 'apps/api/src/app-registrations/user-owned-models.ts',
    },
  },
});
```

## Configuration

`PlatformConformanceOptions`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `sourceRoots` | `readonly string[]` | required | Absolute directories with the app's non-test TypeScript. Never empty. |
| `suites` | `{ cronEnqueueOnly?: CronEnqueueOnlyOptions; userOwnedData?: UserOwnedDataOptions; ...a slice's key once its testing entry is imported }`, each also `{ skip: string }` | required | A suite's options runs it; `{ skip: 'reason' }` opts out and the reason is printed in the run summary (an empty reason, or `false`, throws); an omitted key does not run; an unknown key throws. The option key is the camelCase form of the suite id. |
| `testApi` | `ConformanceTestApi` | the globals `describe`/`it`/`expect` | Inject a runner, or a recording fake in tests. |

`CronEnqueueOnlyOptions`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `exempt` | `Array<{ file, why }>` | required | Files allowed to work inline, relative to the source root, `/` separators. `why` needs more than 40 characters; the file must hold a `@Cron`. |
| `minCronFiles` | `number` | required | Vacuity guard: at least this many files with a `@Cron` must be found. A positive integer. |
| `extraWorkMarkers` | `Array<{ pattern: RegExp, what: string }>` | `[]` | Additive markers for the app's own work helpers. The platform markers always apply. |

`UserOwnedDataOptions`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `schemaPath` | `string` | required | Absolute path to the app's `schema.prisma`, or to a folder of `*.prisma` files (the reference app's composed `prisma/schema/`). |
| `policies` | `readonly UserOwnedModelDef[]` | required | The app's registry contents: import the module that fills `userOwnedModelRegistry`, then pass `userOwnedModelRegistry.list()`. |
| `rawSqlAllowlist` | `Array<{ file, why }>` | required | Files allowed to issue raw SQL, relative to the source root, `/` separators, each with a non-empty reason. |
| `userModel` | `string` | `'User'` | The model whose foreign keys mark ownership. |
| `registerIn` | `string` | `'the user-owned data registry'` | Where the fix goes, quoted in the "no registry entry" message (the reference app names its two registration files). |

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `runPlatformConformance` | option | `runPlatformConformance(options: PlatformConformanceOptions): void` | Register the enabled suites at the top level of a spec file | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `PlatformConformanceOptions` | option | `{ sourceRoots; suites; testApi? }` | Configure the run: where to scan, which suites, which test runner | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `CronEnqueueOnlyOptions` | option | `{ exempt; minCronFiles; extraWorkMarkers? }` | Give the cron suite the app's argued exemptions and vacuity minimum | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `conformanceSuites` | registry | `Registry<ConformanceSuite<any>>` | The suites the runner can run, frozen on the first run; a new suite registers in `conformance-suites.ts` | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `ConformanceSuite` | registry | `interface ConformanceSuite<TOptions>` | Write a suite: `id`, `title`, `description`, a pure `check()` and its `cases()` | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `ConformanceAppSuite` | registry | `interface ConformanceAppSuite<TOptions>` | Write a suite that boots the app: `id`, `title`, `description` and `register(api, context, options)`, which registers its own `describe` tree and hooks | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `ConformanceSkip` | option | `{ skip: string }` | Opt an app out of one suite, with the reason the run summary prints | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `cronEnqueueOnlySuite` | registry | `ConformanceSuite<CronEnqueueOnlyOptions>` | Call the cron suite's `check()` directly in a test | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |
| `UserOwnedDataOptions` | option | `{ schemaPath; policies; rawSqlAllowlist; userModel?; registerIn? }` | Give the user-owned data suite the app's schema, registrations and raw-SQL allowlist | experimental | [example](../../../../apps/api/test/prisma/user-owned-models.spec.ts) |
| `userOwnedDataSuite` | registry | `ConformanceSuite<UserOwnedDataOptions>` | Call the user-owned data suite's `check()` directly in a test | experimental | [example](../../../../apps/api/test/prisma/user-owned-models.spec.ts) |

Supporting types and functions, all `@stability experimental`: `ConformanceTestApi` (the injected runner), `ConformanceReport`, `ConformanceFinding`, `ConformanceCase`, `ConformanceContext`, `ConformanceSummaryEntry` and `formatConformanceSummary` (the run summary).

The Prisma schema reader behind `user-owned-data`, all `@stability experimental`:

| Export | Use it to |
|---|---|
| `readSchemaDatamodel(path)`, `readSchemaText(path)` | Read the models of a `schema.prisma` file or of a folder of `*.prisma` files (name order). |
| `parsePrismaSchema(source)` | Parse schema text: models, fields, `@relation(...)` names, foreign keys, references and `onDelete`. Enums, views, generators, datasources and `@@` attributes are skipped. |
| `effectiveOnDelete(field)` | The referential action Postgres applies: the one written, or Prisma's default (`SetNull` optional, `Restrict` required). |
| `DatamodelModel`, `DatamodelField`, `DatamodelRelation` | The parsed shapes. |

## Data

None.

## Permissions and settings

None.

## UI

None.

## Infra

None. No environment variables. In CI the packages must be built before the app's Jest run (`npm run build:packages`; every job in `ci.yml` does it).

## Observability

None at runtime: this is test tooling. A failing suite names the file and the marker (`<file>: a @Cron body containing a bulk delete`); `user-owned-data` names the schema (`schema: Note.userId is a foreign key to User with no registry entry. Register ...`) or the source file (`notes/raw.ts: uses $executeRaw: add it to the raw-SQL allowlist ...`).

## Security notes

The suite is a tripwire on the shape of a cron body; it does not follow calls into helpers, so a helper's own spec must pin that it only enqueues. Two limits are kept from the original scan and pinned by tests: braces inside comments and strings count toward brace matching, and a decorator options object (`@Cron('...', { name })`) is read as the body, which is reported as "queues nothing" (it fails loudly, never passes silently). The rule itself is unchanged: same ten markers, same enqueue pattern.

`user-owned-data` reads the schema with a line-based parser (models, fields, `@relation` arguments): a relation written across several lines, or an `extend model` block, is not understood; the reference app proves the parser agrees with its generated client (`apps/api/test/prisma/schema-datamodel.spec.ts`). Raw-SQL detection blanks comments and `'...'`/`"..."` strings first and looks for `$queryRaw`, `$executeRaw` and their `Unsafe` variants; a call reached through an alias (`const q = db.$queryRaw`) is still found, one built from a computed property name is not. Scoped access is defence in depth until row-level security (#725); the allowlist is where a reviewer sees every unscoped statement.

## Conformance suite

This slice is the harness. Every suite of the platform, with the entry that registers it, who moved it, what it enforces and how an app runs it:

**API** (`runPlatformConformance`, Jest; the option key is the camelCase suite id).

| Suite id | Owner slice (import to register) | Enforces | Options | Moved by |
|---|---|---|---|---|
| `cron-enqueue-only` | `testing` | Every `@Cron` body enqueues a job and contains none of the ten markers of inline work, except the app's argued exemptions. Three tests: finds the crons at all; exempts `<file>`, on the record (per exemption); queues its work instead of doing it. | `exempt`, `minCronFiles`, `extraWorkMarkers?` | #694 |
| `user-owned-data` | `testing` | Every foreign key to `User` has a user-owned registry entry whose purge policy matches the relation's `onDelete`, every entry names an existing model, field and `exportOmit` column, and only allowlisted files issue raw SQL. | `schemaPath`, `policies`, `rawSqlAllowlist`, `userModel?`, `registerIn?` | #699 (from #688) |
| `on-event-no-io` | `jobs` (`@marinoscar/platform-api/jobs/testing`) | No event-listener body does storage I/O (a direct storage-provider call, `.download(`, `.upload(`): the listener half of queue rule 1. Seven tests: three scan cases and four detector cases, one replaying the listener #520 removed. | `minListenerFiles`, `minListenerBodies?`, `mustScan?`, `extraIoMarkers?` | #742 |
| `ai-kill-switch` | `ai` (`@marinoscar/platform-api/ai/testing`) | With `ai.enabled=false` every discovered `/api/ai/*` route except `GET /api/ai/config` answers `403 AI_DISABLED` (before auth; `scope` `system`, or `org` when only the caller's organization is off), every `/api/admin/ai/*` route stays reachable, and every `ai.*` job makes zero provider calls (AI rule 4). | `fixture`, `minAiRoutes?`, `minAdminAiRoutes?`, `minAiJobTypes?` | #742 (from #435) |
| `ai-rbac-matrix` | `ai` | Every `/api/ai/*` and `/api/admin/ai/*` route crossed with every role and anonymous is granted or denied exactly as the seeded permission set says, with the expected permission read from `x-rbac`; a PAT inherits its owner's grants. | `fixture`, `minRoutes?`, `minPermissionedRoutes?` | #742 (from #435) |
| `ai-secret-egress` | `ai` | No AI response schema has a key-shaped property (the realtime `clientSecret` is the one allowlisted name), and no sentinel key (user, administrator, organization, another user, an MCP header, a presigned URL signature) appears in a body, header, log line, audit row, usage row, run row, stored object or error. | `fixture` | #742 (from #435) |
| `ai-key-policy` | `ai` | The administrator's key is never spent on a user's own inference and the user's key always wins, over every synchronous and queued inference route, checked on the key the fake provider received (AI rule 2). | `fixture` | #742 (from #435) |
| `ai-jobs-server-only` | `ai` | Every `ai.*` job type carries neither `nodeResultSchema` nor `persistNodeResult` and is in `JobHandlerRegistry.serverOnlyTypes()` (AI rule 3). | `fixture`, `minAiJobTypes?` | #742 (from #435) |
| `ai-no-sdk-leak` | `ai` | No provider SDK is imported outside the adapter directory that owns it, none in the app, the web or the contract, and no manifest but the owning package's declares one (AI rule 1). | `apiTrees`, `webTrees`, `sdkOwner?`, `noSdkManifests`, `extraSdkPackages?` | #742 (from #435) |
| `ai-orchestration-boundary` | `ai` | An orchestration library is imported only under the roots the app allows, never from a web source, never declared by a banned manifest (AI rule 6). | `apiSourceRoots`, `webSourceRoots`, `packageJsonPaths`, `allowedRoots`, `banned?`, `minApiFiles?` | #739 (registered by #742) |
| `identity`, `credentials`, `telemetry`, `exports`, `notifications`, `settings`, `storage`, `email`, `onboarding`, `sharing` | the slice of the same name | The slice's own invariants (see its README, "Conformance suite"). Moved by the slice's story; not duplicated here. | see the slice README | slice stories |

**Web** (`runPlatformWebConformance` of `@marinoscar/platform-web/testing`, Vitest): every registered suite runs unless the app skips it by id with a reason. See the [web settings README](../../../platform-web/src/settings/README.md#conformance-suite): `settings-registry-gates`, `settings-registry-shape`, `settings-ai-cards`, `settings-card-routes` and `settings-route-ownership` (all #742, from the reference app's registry tests).

**Database** (`runDbConformance` of `@marinoscar/platform-db`) and **CLI** (`@marinoscar/platform-cli`'s `runPlatformConformance`) have their own runners and READMEs.

Every AI suite that boots the app takes ONE `fixture` (`AiConformanceFixture`, [reference](../../../../apps/api/test/conformance/ai-fixture.ts)): how the app builds itself, mints a user for a role, returns its OpenAPI document, and which grants it seeds. The suites own every assertion. None of them names a path: routes, job types, roles and source trees are discovered or passed.

How an app opts out: `suites: { aiKillSwitch: { skip: 'why' } }`. A skip without a reason throws, and the run prints a table of the suites run and skipped.

Each suite is proved against a planted violation in this package's tests: `test/jobs/testing/on-event-no-io.spec.ts` (a storage download, an upload, an app marker), `test/ai/testing/*.spec.ts` (an ungated AI route, a kill-switched admin route, an unenforced permission, a key-shaped response property, a leaked sentinel, an SDK import outside its adapter, a node-eligible `ai.*` handler, a policy that spends the org key) and `test/testing/no-hardcoded-paths.spec.ts` (no suite names the reference app's layout).

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
| `<Model>.<field> is a foreign key to User with no registry entry` | A model gained a `User` relation. Register it (owner or actor field, purge and export policy, rationale) in the app's registrations; see the [core README](../core/README.md#scoped-data-access). |
| `purge '<p>' requires onDelete <X>, but schema.prisma has <Y>` | The policy and the relation disagree: change one of them. |
| `uses $queryRaw...: add it to the raw-SQL allowlist` | A new file issues raw SQL. Prefer the query API; otherwise add `{ file, why }` to the app's allowlist and make sure no request-derived id reaches it unscoped. |
| `cannot read the schema at` | `schemaPath` does not exist (a composed schema not written yet: run the app's `db:compose`). |

## Links

- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md), "Conformance suites travel with packages" and "The Extension Contract" (guardrails).
- The rule: [job-queue.md](../../../../docs/specs/job-queue.md), "All long-running work is a job".
- Scoped data access and the user-owned registry: [core README](../core/README.md#scoped-data-access).
- How tests are organised: [TESTING.md](../../../../docs/TESTING.md#conformance-suites-in-packages).
- Package README: [platform-api](../../README.md).
