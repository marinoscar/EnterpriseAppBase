# @marinoscar/platform-web/testing

`@marinoscar/platform-web/testing`: test doubles for the web host ports (issue #696) and the web conformance harness `runPlatformWebConformance()` (issue #742). A packaged page's tests render it inside `PlatformHostProvider` with a test host that answers API calls from a table and records every request, so they need neither the app, its transport nor a mock server. Depends on the `core` slice (`packages/platform-slices.json`).

## Purpose and scope

Does: `createTestPlatformHost({ permissions, userId, features, responses, formatRelativeTime, applyTheme, extensions })` (a `PlatformWebHost` plus `requests`, the log of every call) `createTestApiError(status, message, code?)` (a rejection shaped like the app adapter's errors) and `createTestBlobResponse(body, headers?)` (a canned download for the host's `getBlob`, answered from the same `responses` table under `'GET <path>'`).

Also: `runPlatformWebConformance(options)`, which registers one `describe` block per web conformance suite over the app's own registries and route table (a slice's `testing` entry registers its suites, and an app registers its own; the settings slice's are in [the settings README](../settings/README.md#conformance-suite)), hands each suite the options the app passed under its id, makes an opt-out visible and requires its reason, and prints a summary table.

Does not: run in production, mock `fetch`, or replace the app's own wiring tests (the reference app keeps msw tests through its real transport and real host adapter).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it in tests only:

```ts
import { createTestApiError, createTestPlatformHost } from '@marinoscar/platform-web/testing';
```

No extra peer. It imports no test runner, so it works under Vitest and Jest alike.

## Quick start

```tsx
const host = createTestPlatformHost({
  permissions: ['system_settings:read'],
  responses: { 'GET /admin/doctor': report },
});
render(
  <MemoryRouter>
    <PlatformHostProvider host={host}><DoctorPage /></PlatformHostProvider>
  </MemoryRouter>,
);
expect(host.requests.map((r) => r.path)).toEqual(['/admin/doctor']);
```

The package's own Doctor tests (`packages/platform-web/test/doctor/`) are the complete example.

### Adding a web suite from an app or a package

An invariant over what the app declares (its routes, its registries, its destinations) is a web suite. It takes its own options, which the app passes under the suite's id, and registers itself with `webConformanceSuites`; no package is edited. The worked example, with a planted violation, is [`app-routes.suite.ts`](../../../../apps/web/src/__tests__/examples/testing/app-routes.suite.ts) and its [test](../../../../apps/web/src/__tests__/examples/testing/app-routes.suite.test.ts).

```ts
// apps/web/src/__tests__/conformance/app-routes.suite.ts
import { webConformanceSuites } from '@marinoscar/platform-web/testing';
import type { WebConformanceSuite } from '@marinoscar/platform-web/testing';

export interface AppRoutesOptions {
  readonly requiredRoutes: readonly string[];
}

export const appRoutesSuite: WebConformanceSuite<AppRoutesOptions> = {
  id: 'app-routes',
  title: 'the app declares the routes its navigation promises',
  description: 'Every required route is declared in the route table.',
  register(api, context, options) {
    if (options === undefined) throw new Error("app-routes: pass suites['app-routes'] = { requiredRoutes }, or skip it with a reason.");
    api.describe('the app declares the routes its navigation promises', () => {
      api.it('declares every required route', () => {
        const declared = Array.isArray(context.routes) ? context.routes.map((route) => route.path) : [];
        api.expect(options.requiredRoutes.filter((path) => !declared.includes(path))).toEqual([]);
      });
    });
  },
};

webConformanceSuites.register(appRoutesSuite);
```

```ts
// apps/web/src/__tests__/conformance.test.ts
import './conformance/app-routes.suite'; // before runPlatformWebConformance
runPlatformWebConformance({ ...appData, suites: { 'app-routes': { requiredRoutes: ['/orders'] } } });
```

- **Options are the third argument.** A suite typed `WebConformanceSuite<Options>` receives what the app passed under its id, or `undefined` when it passed nothing (the platform's `settings-*` suites take none). An entry with a `skip` key is an opt-out, never options.
- **A suite runs unless skipped.** Every registered suite runs; one that needs options and gets none throws a message naming the key.
- **Ids are unique.** `register` throws on a second suite under a registered id (a duplicate would silently never run), and after the harness has run. `webConformanceSuites.has(id)` guards an idempotent registration.
- **The matcher subset** a suite may use: `toEqual`, `toBe`, `toMatchObject`, `toHaveLength`, `toThrow`, `toContain`, `toBeGreaterThanOrEqual`.
- **It can fail.** Ship a test that plants a violation and asserts the suite names it.

## Configuration

`createTestPlatformHost(options)`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `permissions` | `readonly string[]` | `[]` | What `viewer.hasPermission` answers `true` for. |
| `userId` | `string \| null` | `'test-user'` | `viewer.userId`. |
| `features` | `Record<string, boolean>` | `{}` | What `viewer.isFeatureEnabled` answers `true` for. |
| `responses` | `Record<string, TestApiResponse>` | `{}` | Looked up by `"<METHOD> <path with query>"`, then `"<METHOD> <path>"`, then `"<path>"`. A value resolves as the data; a function receives the request and may return, resolve, throw or reject. An unmatched request rejects with a 404 `PlatformApiError`. |
| `formatRelativeTime` | `(iso) => string` | none | The host's formatter. |
| `applyTheme` | `(theme) => void` | none | The host's theme setter (the Appearance page, #892). A multipart upload answers from `'POST <path>'` like any POST. |

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

The test doubles are not extension points; apps extend nothing there. The conformance harness is:

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `runPlatformWebConformance` | option | `runPlatformWebConformance(options: PlatformWebConformanceOptions): void` | Run the platform's web suites over the app's registries, routes and destinations, in one test file | experimental | [example](../../../../apps/web/src/__tests__/conformance.test.ts) |
| `PlatformWebConformanceOptions` | option | `{ adminSections; userSettingsSections; hubs; routes; apiPermissions; openApiDocument?; destinations?; suites?; testApi?; summaryOutput? }` | Pass the app's data and, per suite id, that suite's options or an argued `{ skip: 'reason' }` | experimental | [example](../../../../apps/web/src/__tests__/conformance.test.ts) |
| `WebConformanceSuite` | registry | `interface WebConformanceSuite<TOptions> { id; title; description; register(api, context, options) }` | Write a web suite, in a slice's `testing` entry or in the app | experimental | [example](../../../../apps/web/src/__tests__/examples/testing/app-routes.suite.ts) |
| `webConformanceSuites` | registry | `{ register(suite); has(id); list(); ids() }` | Register a suite when the slice's testing entry is imported, or from the app; a duplicate id throws and the registry freezes on the first run | experimental | [example](../../../../apps/web/src/__tests__/examples/testing/app-routes.suite.ts) |
| `WebConformanceSuiteEntry` | option | `{ skip: string } \| Record<string, unknown>` | The type of one value of `suites`: a suite's options, or its opt-out | experimental | [example](../../../../apps/web/src/__tests__/examples/testing/app-routes.suite.test.ts) |

## Data

None. Responses live in memory for one test.

## Permissions and settings

None. `permissions` only feeds the fake viewer.

## UI

None.

## Infra

None.

## Observability

None.

## Security notes

Test-only. A host that answers from a table has no authorization at all; never mount it in an app.

## Conformance suite

This slice is the web harness. The suites it runs are registered by slices. The web suite ids, with the slice that owns each:

| Suite id | Owner slice | What it proves | How an app runs it |
|---|---|---|---|
| `settings-registry-gates` | settings | Every settings card's `permission` / `feature` is a string the API enforces. | Runs from the app's registries ([settings README](../settings/README.md#conformance-suite)). |
| `settings-registry-shape` | settings | One declaration per card; the registries are well formed. | As above. |
| `settings-ai-cards` | settings | Every AI card declares `feature: 'ai'` (the admin `AI` card excepted). | As above. |
| `settings-card-routes` | settings | Every card has a route. | As above. |
| `settings-route-ownership` | settings | Every route belongs to a destination (`external: true` destinations excepted). | As above. |
| `shell-local-host` | shell | A single-user host with no API renders the whole shell (`ShellRoot` > `PlatformHostProvider` > `LocalIdentityProvider` > `ShellPreferencesProvider` > `ShellLayout`) with zero calls to the host `api`; destinations follow the local permissions; the rail preference survives a remount through the port; the user menu has no sign-out and no organization switcher. | `suites: { 'shell-local-host': { navigation, permissions } }` in a host with no API, or `{ skip: 'reason' }` in a web app with a server (#997, [shell README](../shell/README.md#running-in-a-local-single-user-no-api-host)). |

See the [settings README](../settings/README.md#conformance-suite) for the first five, and the [API testing README](../../../platform-api/src/testing/README.md#conformance-suite) for the table of every suite id of the platform. The harness itself is pinned by `test/testing/web-conformance.test.ts` (an unknown id and a skip without a reason throw, a duplicate id throws, options reach the suite, the registry freezes on the first run, the summary lists the suites run and skipped).

## Upgrade notes

None (first release, #696). #997 adds the web suite `shell-local-host` (additive: an app that runs the harness gets it, and must pass its options or skip it with a reason).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `a suite with id "x" is already registered` | Two suites claim one id, or a file registers twice. Rename yours, or guard with `webConformanceSuites.has(id)`. |
| `pass suites['x'] = ...` from a suite | The suite needs options and the app passed none; add the entry under its id, or skip it with a reason. |
| `No test response for GET /x` (404) | The page called a path the table does not list; add the key, or check the query string. |
| A response function's `throw` is not seen as an API error | Throw `createTestApiError(status, message)`, not a plain `Error`. |

## Links

- [core README](../core/README.md): the ports these doubles stand in for.
- Package README: [platform-web](../../README.md).
