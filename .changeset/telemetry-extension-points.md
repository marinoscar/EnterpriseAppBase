---
"@marinoscar/platform-api": minor
"@marinoscar/platform-contract": minor
"@marinoscar/platform-web": minor
---

Let an app put its own numbers on the Telemetry Dashboard and in the assistant (PP-14.18, #936).

Units: `registerMetricUnit(MetricUnitDef)` of `@marinoscar/platform-api/telemetry`; the 15 built-in units register through it (`BUILTIN_METRIC_UNITS`, with `METRIC_UNITS` kept as a deprecated alias), `assertUnit` reads the registry and `GET dashboard/metric-groups` serves, per group, `units` (the descriptors of the units it uses beyond the built-ins) so the browser formats an app unit with no web change. A unit descriptor has one of nine fixed formats and no code (`metricUnitDescriptorSchema`).

Presentation: `MetricGroupDef.presentation` is data (tiles, charts with theme-token colours, tables with Top N and `problems-first` or `value-desc` sort and column displays, and `ratio`, `delta` and `rate` virtual columns), zod-validated and bounded when the group is registered, and served on `/metric-groups`. The six platform groups declare theirs (`PLATFORM_METRIC_PRESENTATIONS` of the contract) instead of the web's section table, and draw with the same DOM. `metricGroupPresentationSchema` and the presentation interfaces are new contract exports.

Panels: `registerDashboardPanel(DashboardPanelDef)` and `dashboardPanelRegistry` (API; `GET dashboard/panels` and `panels/:id`, payload at most 256 KiB, a time budget, a generic failure) with `registerDashboardPanelView(id, View, { frame? })` (web, also from the new `@marinoscar/platform-web/telemetry/ui/dashboard-panels`). The platform's `api` and `logs` panels register through the same calls. `TelemetryQueryFacade` (`query`, `sql`, `dialect`) is the only way a panel reads the store: one guarded, capped, timed-out and audited statement per call (audit source `panel`), under a per-request statement budget.

Assistant: `registerTelemetryAssistantTool(TelemetryAssistantToolDef)` adds a read-only tool that receives the facade and never a client (a name that shadows one of the eight built-ins is refused; `rows` output is withheld from the model while `assistant.shareResults` is off), and `TelemetryModule.forRoot({ assistant: { extraInstructions } })` appends developer notes (at most 4 000 characters of plain text) to the system prompt as an `APPLICATION NOTES` section.

Pages: `TelemetryDashboardPage`, `TelemetrySettingsPage` and `TelemetryExplorerPage` take `slots` of the page-slot contract and are off `page-slots.exempt.json`; the explorer also takes `starterQueries`.

otel-core: `initializeOtel` accepts `spanProcessors`, `logRecordProcessors`, `metricReaders`, `views`, `sampler`, `textMapPropagator` and `resourceAttributes`; every processor and reader is wrapped in a gated one (`GatedSpanProcessor`, `GatedLogRecordProcessor`, `GatedMetricReader`), so nothing exports while the runtime gate is closed.

Conformance: the `telemetry` suite gains check 9 (registered panels and tools are well formed, the platform's panels remain) and check 10 (the facade has exactly `query`, `sql` and `dialect` and is frozen), and check 1 validates presentations. `/telemetry/testing` exports `createQueryFacade`, `checkFacadeSurface` and `checkRegisteredExtensions`.

Additive: a host that registers nothing sees no change except the new optional `presentation` and `units` fields on `GET dashboard/metric-groups` and the new `dashboard/panels` routes.
