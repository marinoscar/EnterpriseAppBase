# @marinoscar/platform-web/telemetry

`@marinoscar/platform-web/telemetry`: the telemetry UI (issue #704): the Telemetry settings page, the SQL Explorer with its AI assistant, and the Dashboard, in two entry points of one slice. `/telemetry/headless` holds the client, the hooks, the config provider and route guard, the app adapters, the theme-token contract and pure helpers, with no component; `/telemetry/ui` holds the three route components and the admin registry cards, and each page also has a subpath of its own (`/telemetry/ui/settings-page`, `/explorer-page`, `/dashboard-page`) so a lazy route keeps its own chunk. Depends on the `core` slice only (`packages/platform-slices.json`): it reads the app through `usePlatformHost()`. The full catalog of seams arrives with #707; this README documents what is exported today.

## Purpose and scope

Does: render and drive the telemetry routes of `@marinoscar/platform-api/telemetry` (config and status, the GreptimeDB connection, the telemetry services stack, read-only SQL query, schema and export, the assistant stream, the dashboard's summary, timeseries, top lists, events, filters and metric groups). The wire types and limits come from `@marinoscar/platform-contract/telemetry` (#702), imported as types and from the zod-free constants module only. A metric group the API reports renders as a dashboard section titled from its metadata, so an app group (EvoPath's `coach`) needs no web code.

Does not: decide anything (the API's SQL guard, row caps and permission checks are the gate; the browser presents and collects), own the registry or the routes (the app places the cards and routes them behind its own permission gate), create a theme (the app passes its themes through `withTelemetryTokens`), or own the AI switch and model catalogue (the app hands them in through `TelemetryWebAdapters` until the AI slice is packaged).

## Install and peer dependencies

Ships inside `@marinoscar/platform-web`; import it by its subpaths:

```ts
import { TelemetryConfigProvider, RequireTelemetryEnabled, withTelemetryTokens } from '@marinoscar/platform-web/telemetry/headless';
import { telemetryAdminCards } from '@marinoscar/platform-web/telemetry/ui';
const TelemetryDashboardPage = lazy(() => import('@marinoscar/platform-web/telemetry/ui/dashboard-page'));
```

`/telemetry/ui` needs the optional peers `@mui/x-charts` (dashboard charts), `@mui/x-data-grid` (explorer results), `@uiw/react-codemirror` and `@codemirror/lang-sql` (the explorer's editor, lazy-loaded), besides the package peers `@mui/material`, `@mui/icons-material`, `@emotion/*`, `react-router-dom`. `/telemetry/headless` needs `react`, `react-router-dom` (the guard's redirect) and `@mui/material/styles` (the token contract) only; it imports no MUI component module (an ESLint rule and `test/telemetry/boundaries.test.ts` enforce it). Both use `@marinoscar/platform-contract`, whose peer `zod` the app installs; it is not bundled.

## Quick start

The reference app binds the slice in five places:

```tsx
// apps/web/src/App.tsx: the providers (the config provider sits ABOVE the
// platform host, which reads the feature it answers, so it takes the transport)
<TelemetryConfigProvider api={appPlatformApi}>
  <TelemetryWebAdaptersProvider adapters={appTelemetryAdapters}>
    <AppPlatformHostProvider><Layout /></AppPlatformHostProvider>
  </TelemetryWebAdaptersProvider>
</TelemetryConfigProvider>

// apps/web/src/App.tsx: one route per card, behind the app's permission gate
<Route path="/admin/settings/telemetry/dashboard" element={
  <RequirePermission permission="telemetry:query" fallback={<Navigate to="/" replace />}>
    <RequireTelemetryEnabled><TelemetryDashboardPage /></RequireTelemetryEnabled>
  </RequirePermission>
} />

// apps/web/src/config/adminSections.tsx: the Observability cards, in place
cards: [...telemetryAdminCards, { ...doctorSettingsPage.card, Icon: doctorSettingsPage.Icon }],

// apps/web/src/theme/index.ts
export const lightTheme = withTelemetryTokens(createTheme({ ... }));

// apps/web/src/platform/telemetryAdapters.ts: AI on/off, the model catalogue, the spinner
export const appTelemetryAdapters: TelemetryWebAdapters = { useAiEnabled, useAssistantModels, Spinner: LoadingSpinner };
```

## Configuration

| Option | Type | Default | Meaning |
|---|---|---|---|
| `TelemetryConfigProvider` `api` | `PlatformApiClient` | the platform host's | The transport for `GET /telemetry/config`; required when mounted above `PlatformHostProvider`. |
| `TelemetryWebAdaptersProvider` `adapters` | `TelemetryWebAdapters` | `DEFAULT_TELEMETRY_WEB_ADAPTERS` (AI off, no models, no spinner) | What the pages need from the app beyond the host. Keep it a module constant. |
| `RequireTelemetryEnabled` `fallback` | `ReactNode` | `<Navigate to="/" replace />` | Rendered while telemetry is off. |
| `RequireTelemetryEnabled` `loading` | `ReactNode` | the adapter's `Spinner`, else nothing | Rendered while the first answer is in flight. |
| `useTelemetryStack` options | `{ activeIntervalMs?, idleIntervalMs? }` | 3 s while a deploy runs, 30 s otherwise | Poll intervals; `0` disables polling. |

The app's transport must implement `postBlob` (the export) and `postSse` (the assistant stream) of `PlatformApiClient`; without them the export and the assistant report an error instead of failing silently.

### Theme tokens

Colours that carry meaning come from `palette.status.{ok,warn,crit,info,neutral}` and chart series from `palette.chart.series` (the contract of #686, now shipped here with its MUI module augmentation). `withTelemetryTokens(theme)` fills only the tokens the app has not set, from the theme's own palette, and returns a copy: `ok` = `success.main`, `warn` = `warning.main`, `crit` = `error.main`, `info` = `info.main`, `neutral` = `grey[500]`, `chart.series` = the `.main` of `primary`, `secondary`, `warning`, `success`, `error`, `info`, then `grey[500]`, `text.primary`. Series colours are never used for status, and status colours never as a series. An app value always wins:

```ts
createTheme({ palette: { status: { crit: '#b00020' }, chart: { series: ['#0057b8', '#ffd700'] } } });
```

EvoPath mapping (#719): set `palette.chart.series` from its `theme/chartPalette.ts` series (what its `MetricSeriesChart`, `ApiTimelineChart` and `LogSeverityChart` copies read through `useChartSeries()`) and map its `palette.outline` to `palette.status.neutral`. Its identical `PaletteChart` augmentation merges with this slice's.

## Extension-point catalog

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `withTelemetryTokens` | theme-token | `withTelemetryTokens(theme: Theme): Theme` | Give the app's themes the telemetry tokens, keeping any the app set | experimental | [example](../../../../apps/web/src/theme/index.ts) |
| `TelemetryStatusTokens` | theme-token | `{ ok; warn; crit; info; neutral }` (`palette.status`) | Restyle what a value means (5xx, error logs, down) | experimental | [example](../../../../apps/web/src/__tests__/theme/telemetryTokens.test.ts) |
| `TelemetryChartTokens` | theme-token | `{ series: string[] }` (`palette.chart`) | Restyle chart series colours | experimental | [example](../../../../apps/web/src/__tests__/theme/telemetryTokens.test.ts) |
| `TelemetryWebAdapters` | option | `{ useAiEnabled(); useAssistantModels(); Spinner? }` | Hand the pages the app's AI switch, model catalogue and spinner | experimental | [example](../../../../apps/web/src/platform/telemetryAdapters.ts) |
| `telemetryAdminCards` | component | `readonly TelemetryAdminCard[]` | Place the three Observability cards in the app's admin registry | experimental | [example](../../../../apps/web/src/config/adminSections.tsx) |
| `TelemetrySettingsPage` | component | `TelemetrySettingsPage(): ReactElement` | Route `/admin/settings/telemetry` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `TelemetryExplorerPage` | component | `TelemetryExplorerPage(): ReactElement` | Route `/admin/settings/telemetry/explorer` | experimental | [example](../../../../apps/web/src/App.tsx) |
| `TelemetryDashboardPage` | component | `TelemetryDashboardPage(): ReactElement` | Route `/admin/settings/telemetry/dashboard` | experimental | [example](../../../../apps/web/src/App.tsx) |

Each page subpath (`/telemetry/ui/settings-page`, `/explorer-page`, `/dashboard-page`) re-exports its page as `default` and by name, for `lazy(() => import(...))` in a chunk of its own.

Supporting exports. `/telemetry/headless`: the wire types and display constants of the two services (`TelemetryPublicConfig`, `TelemetryAdminConfig`, `TelemetryConnection*`, `TelemetryStack*`, `TelemetryQueryResult`, `TelemetrySchema*`, `TelemetryAssistant*`, `Dashboard*`, `TELEMETRY_EXPORT_*`, `DASHBOARD_*`, ...) and their pure helpers (`dashboardSearchParams`, `sqlList`, `telemetryErrorReason`, `filenameFromContentDisposition`, `downloadBlob`, ...); `createTelemetryClient`, `useTelemetryClient`, `TelemetryClient`; `TelemetryConfigProvider`, `TelemetryConfigContext`, `useTelemetryConfig`, `useTelemetryFeatures`, `isTelemetryOn`, `TELEMETRY_CONFIG_DISABLED`; `RequireTelemetryEnabled`; `TelemetryWebAdaptersProvider`, `useTelemetryWebAdapters`, `DEFAULT_TELEMETRY_WEB_ADAPTERS`; the hooks `useTelemetryAdmin`, `useTelemetryConnection`, `useTelemetryStack`, `useTelemetrySchema`, `useTelemetryQuery`, `useTelemetryAssistant`, `useTelemetryAssistantAvailable`, `useTelemetryAssistantModel`, `useDashboard*`; `telemetryTokens`, `useTelemetryTokens`, `TelemetryTokens`; `formatBytes`, `formatDuration`, the three route paths, `explorerSqlUrl`, `METRIC_SECTION_TITLES`, `metricSectionTitle`, `STARTER_QUERIES`, `traceQuery`, `QUERY_HISTORY_KEY`. `/telemetry/ui`: `TelemetryAdminCard`.

## Data

None. The slice owns no table; the explorer's query history (`telemetry-explorer:history`) and table top-N choices are per-browser `localStorage` conveniences, and everything else is read through the host's transport.

## Permissions and settings

The cards and routes use the exact strings the telemetry controllers enforce: `Telemetry` requires `telemetry:read` (saving needs `telemetry:write`, gated inside the page) and has no `feature`, because it is where telemetry is switched on; `Telemetry Explorer` and `Telemetry Dashboard` require `telemetry:query` and `feature: 'telemetry'` (a store deployed and collection on). Inside the settings page the model picker needs `ai_config:read` and the services section `system_settings:read` (`system_settings:write` to deploy). The assistant shows only for `ai:use` while AI and the assistant are on (`useTelemetryAssistantAvailable`). All of these only hide controls; the API enforces each.

## UI

Three pages under `/admin/settings/telemetry`, contributed as three admin registry cards in the Observability section (icons `InsightsOutlined`, `TerminalOutlined`, `MonitorHeartOutlined`). No slots. Theme tokens `palette.status.*` and `palette.chart.series` (see Configuration). Components stay internal to the slice until a consumer needs one.

## Infra

None. The telemetry stack's compose fragments and collector config are `@marinoscar/platform-infra/telemetry`.

## Observability

None. The pages log nothing; the API traces and logs every telemetry route.

## Security notes

The browser never sees a GreptimeDB or AI key: connection passwords are write-only (sent, never read back), the assistant streams from the API, and exports are fetched through the app's authenticated transport. SQL typed in the explorer is sent verbatim and the API's guard decides whether it runs. Error messages are shown as text.

## Conformance suite

None yet (#707). The package's `test/telemetry/` covers the slice with `createTestPlatformHost`; the reference app's `apps/web/src/__tests__/config/platformPages.test.ts` checks the card and route registration and its page tests drive the pages through the app's transport.

## Upgrade notes

First packaged release (#704). Moving from the app's own telemetry UI: delete `components/telemetry/`, `pages/Admin/Telemetry*Page.tsx`, `hooks/useTelemetry*.ts`, `services/telemetry*.ts`, `contexts/TelemetryConfigContext.tsx`, `components/common/RequireTelemetryEnabled.tsx` and the token files; import from the two entries; pass `api` to `TelemetryConfigProvider` when it sits above the platform host; mount `TelemetryWebAdaptersProvider`; add `postBlob` and `postSse` to the app's `PlatformApiClient`. Behaviour, texts, test ids and colours are unchanged. Service functions became methods of `TelemetryClient` with the same names.

## Troubleshooting

| Symptom | Cause and fix |
|---|---|
| `usePlatformHost: no PlatformHostProvider above this component` | Mount `PlatformHostProvider` (from `/core`) around the routes, and in test wrappers. |
| Telemetry routes bounce home although it is on | `TelemetryConfigProvider` above the host was given no `api`; pass the app's transport. |
| The assistant never shows | The adapters are missing (AI reads as off) or the viewer lacks `ai:use`. |
| "The platform host transport has no postBlob / postSse" | The app's `PlatformApiClient` lacks the member; add it (the reference app's `apps/web/src/platform/platformHost.tsx`). |
| All three pages land in one chunk | Lazy-load each from its page subpath, not from `/telemetry/ui`. |

## Links

- Spec: [docs/specs/telemetry.md](../../../../docs/specs/telemetry.md); runbook: [docs/runbooks/telemetry.md](../../../../docs/runbooks/telemetry.md).
- Wire contract: [`@marinoscar/platform-contract/telemetry`](../../../platform-contract/src/telemetry/README.md).
- Hosting and registration: [core README](../core/README.md).
- Package README: [platform-web](../../README.md).
