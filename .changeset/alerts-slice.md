---
"@marinoscar/platform-contract": minor
"@marinoscar/platform-api": minor
"@marinoscar/platform-db": minor
---

Add the `alerts` slice (#1047). `@marinoscar/platform-contract/alerts` carries the wire shapes (rules, the configs of the built-in kinds, incidents, the dry-run response, the kind catalog, the summary). `@marinoscar/platform-api/alerts` adds `AlertsModule.forRoot`, the open rule-kind registry (`registerAlertRuleKind`) with the `metric_threshold`, `node_event`, `verdict`, `node_offline` and `telemetry_unavailable` kinds, the pending/firing/resolved state machine, the `alerts.evaluate`, `alerts.evaluate_event` and `alerts.incidents_purge` server-only jobs, notifications on a transition with an optional webhook port (`ALERTS_WEBHOOK_EMITTER`), eight disabled starter rules, the `/api/admin/alerts` routes behind the new `alerts:read` and `alerts:write` permissions, and the `alerts` conformance suite (`@marinoscar/platform-api/alerts/testing`). The telemetry slice now exports `TelemetryDashboardService` and `createQueryFacade`, accepts a `null` (system) user and an `alert` query source, and the nodes slice exports `deriveNodeHealth`. `@marinoscar/platform-db` adds migration `0040_add_alerts` (`alert_rules`, `alert_incidents` and the raw-SQL partial unique index `alert_incidents_open_uniq_idx`).
