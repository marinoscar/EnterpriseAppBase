---
"@marinoscar/platform-api": minor
---

Add the `otel-core` slice: `@marinoscar/platform-api/otel-core/sdk` (the Nest-free `initializeOtel()` bootstrap, the runtime `telemetryGate` and its gated exporters, the service-name and instance-id resolvers) and `@marinoscar/platform-api/otel-core` (the `MetricsHostService` metrics host and `OtelMetricsModule`, the app-metric name registry, label bounding, the gauge-provider seam, `registerRequestSpanAttributes` and `@Trace()`).
