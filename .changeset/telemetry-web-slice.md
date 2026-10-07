---
"@marinoscar/platform-web": minor
---

Add the telemetry slice (`@marinoscar/platform-web/telemetry/headless`, `/telemetry/ui` and a subpath per page): the telemetry settings page, explorer and dashboard with their client, hooks, config provider, route guard, `TelemetryWebAdapters`, `telemetryAdminCards` and the `withTelemetryTokens` theme-token contract. `PlatformApiClient` gains optional request options (`signal`, `ifMatch`), `postBlob` and `postSse`, and `PlatformApiError` an optional `details`; the test host answers all of them.
