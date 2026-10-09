# @marinoscar/platform-web/testing

`@marinoscar/platform-web/testing`: test doubles for the web host ports (issue #696) and the web conformance harness `runPlatformWebConformance()` (issue #742). A packaged page's tests render it inside `PlatformHostProvider` with a test host that answers API calls from a table and records every request, so they need neither the app, its transport nor a mock server. Depends on the `core` slice (`packages/platform-slices.json`).

## Purpose and scope

Does: `createTestPlatformHost({ permissions, userId, features, responses, formatRelativeTime, applyTheme })` (a `PlatformWebHost` plus `requests`, the log of every call) `createTestApiError(status, message, code?)` (a rejection shaped like the app adapter's errors) and `createTestBlobResponse(body, headers?)` (a canned download for the host's `getBlob`, answered from the same `responses` table under `'GET <path>'`).

Also: `runPlatformWebConformance(options)`, which registers one `describe` block per web conformance suite over the app's own registries and route table (a slice's `testing` entry registers its suites; the settings slice's are in [the settings README](../settings/README.md#conformance-suite)), makes an opt-out visible and requires its reason, and prints a summary table.

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

The test doubles are not extension points; apps extend nothing there. The conformance harness is:

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `runPlatformWebConformance` | option | `runPlatformWebConformance(options: PlatformWebConformanceOptions): void` | Run the platform's web suites over the app's registries, routes and destinations, in one test file | experimental | [example](../../../../apps/web/src/__tests__/conformance.test.ts) |
| `PlatformWebConformanceOptions` | option | `{ adminSections; userSettingsSections; hubs; routes; apiPermissions; openApiDocument?; destinations?; suites?; testApi?; summaryOutput? }` | Pass the app's data and, per suite id, an argued `{ skip: 'reason' }` | experimental | [example](../../../../apps/web/src/__tests__/conformance.test.ts) |
| `WebConformanceSuite` | registry | `interface WebConformanceSuite { id; title; description; register(api, context) }` | Write a web suite in a slice's `testing` entry | experimental | [example](../../../../apps/web/src/__tests__/conformance.test.ts) |
| `webConformanceSuites` | registry | `{ register(suite); list(); ids() }` | Register a suite when the slice's testing entry is imported; frozen on the first run | experimental | [example](../../../../apps/web/src/__tests__/conformance.test.ts) |

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

This slice is the web harness. The suites it runs are registered by slices; see the [settings README](../settings/README.md#conformance-suite) for `settings-registry-gates`, `settings-registry-shape`, `settings-ai-cards`, `settings-card-routes` and `settings-route-ownership`, and the [API testing README](../../../platform-api/src/testing/README.md#conformance-suite) for the table of every suite id of the platform. The harness itself is pinned by `test/testing/web-conformance.test.ts` (an unknown id and a skip without a reason throw, the registry freezes on the first run, the summary lists the suites run and skipped).

## Upgrade notes

None (first release, #696).

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `No test response for GET /x` (404) | The page called a path the table does not list; add the key, or check the query string. |
| A response function's `throw` is not seen as an API error | Throw `createTestApiError(status, message)`, not a plain `Error`. |

## Links

- [core README](../core/README.md): the ports these doubles stand in for.
- Package README: [platform-web](../../README.md).
