---
"@marinoscar/platform-api": minor
"@marinoscar/platform-contract": minor
"@marinoscar/platform-web": minor
---

Make the dashboard metric tables' freshness window an option: `TelemetryModule.forRoot({ metrics: { freshMs } })` (default `METRIC_FRESH_MS`, 150 s; resolved into the `TELEMETRY_METRIC_FRESH_MS` token). The `/metrics` response reports it as the optional `freshMs`, and each dashboard section with a table shows it in its header ("Current within 2 min 30 s").
