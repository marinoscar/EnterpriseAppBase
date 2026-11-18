# Runbook: Set up and tune alerts

> **Audience:** operators · **Spec:** [alerts.md](../specs/alerts.md) · **Admin UI:** the Alerts page (Observability group) · **Permission:** `alerts:read` to look, `alerts:write` to change

Use this when you want to be told that a worker laptop went on battery, a host is short of CPU or memory, a node is offline, jobs are failing, or the telemetry verdict is critical, without watching a dashboard. It covers enabling the starter rules, creating a metric rule, dry-running it, acknowledging incidents, tuning the wait and cooldown, and what happens when telemetry is off. The commands use the API through `appctl api`; the Alerts page does the same.

## 1. Before you start

- You need an Admin account (`alerts:read` and `alerts:write`).
- Node-event and offline rules need worker nodes ([run-worker-nodes.md](run-worker-nodes.md)). Metric and verdict rules need telemetry switched on ([telemetry.md](telemetry.md)); the node-event and offline rules do not.
- Notifications go to every holder of `alerts:read` (admins) on the channels they allow in their own preferences. Check `/admin/settings/notifications` has the channel on, and email is configured if you rely on it ([vapid-keys.md](vapid-keys.md) for push).
- List the rules and note their ids and keys:

```bash
appctl api GET /api/admin/alerts/rules --raw | jq '.data[] | {id, key, enabled, kind, lastError}'
```

All eight starter rules exist and are disabled.

## 2. Enable the starter rules

| Goal | Enable the rule | What you get |
|---|---|---|
| Laptops on battery | `nodes.on_battery` | A warning when a node switches from AC to battery; resolves when AC returns (or after 24 h) |
| Battery running out | `nodes.battery_low` | A warning on `power.battery_low` or `power.battery_critical`; resolves on `power.battery_recovered` (or after 6 h) |
| CPU pressure | `nodes.host_cpu_high` | A warning when a host averages above 90 % CPU for 5 minutes |
| Memory pressure | `nodes.host_memory_low` | A warning when a host has under 512 MiB available for 5 minutes |
| Offline nodes | `nodes.offline` | A critical alert when a node is stale or offline for 60 seconds |

Others: `jobs.failure_spike`, `telemetry.verdict_critical`, `telemetry.unavailable`.

1. Dry-run first ([§4](#4-test-a-rule)).
2. Enable it:

```bash
appctl api PATCH /api/admin/alerts/rules/<id> --data '{ "enabled": true }'
```

3. Within a minute `lastEvaluatedAt` is set and `lastError` is `null`. A node-event rule also evaluates the moment a node reports an event.

A starter rule can be edited (name, severity, thresholds, channels) and disabled, but not deleted. Your edits survive upgrades.

## 3. Create a metric rule

1. Find the metric in the Telemetry Explorer ([telemetry.md](telemetry.md)); use its dotted name (for example `app.nodes.host.load1`). The store may add a unit suffix to the table name; the rule accepts either form.
2. Create the rule:

```bash
appctl api POST /api/admin/alerts/rules --data '{
  "name": "Worker load high",
  "kind": "metric_threshold",
  "severity": "warning",
  "config": {
    "metric": "app.nodes.host.load1",
    "aggregation": "avg",
    "windowSeconds": 300,
    "comparator": "gt",
    "threshold": 8,
    "groupBy": ["node_id"]
  },
  "forSeconds": 300,
  "cooldownSeconds": 900
}'
```

3. Aggregations are `avg`, `max`, `min`, `sum`, `last` and `rate` (the increase per minute over the window, for counters). `groupBy` (at most 3 attributes) makes one incident per value; `filters` (at most 5, `eq` or `neq`) narrow the series. The rule is created disabled; dry-run, then enable.
4. A bad config answers `400 ALERT_INVALID_CONFIG`. `GET /api/admin/alerts/kinds` returns the JSON Schema of each kind's config.

## 4. Test a rule

```bash
appctl api POST /api/admin/alerts/rules/<id>/test --raw | jq '.data'
```

The answer lists the observations the rule produces right now: labels, value, whether each is breached and a summary. Nothing is stored and nothing is sent. An empty list means no series matched (check the metric name, filters and that nodes are reporting); an error means the store is unreachable ([§7](#7-when-telemetry-is-off)).

## 5. Read and acknowledge incidents

```bash
appctl api GET '/api/admin/alerts/incidents?state=firing' --raw | jq '.data'
appctl api POST /api/admin/alerts/incidents/<id>/acknowledge
appctl api GET /api/admin/alerts/summary --raw | jq '.data'
```

States: `pending` (breached, waiting out `forSeconds`), `firing`, `resolved`. Acknowledging marks that someone is on it; it does not silence notifications or change the state. The incident resolves by itself on the first clean evaluation. Resolved incidents are kept 90 days.

## 6. Tune for, cooldown and channels

- **`forSeconds`** is how long the condition must hold before the alert fires. Raise it for noisy metrics; use 0 for events that matter at once. A condition that clears before the wait leaves no incident.
- **`cooldownSeconds`** (default 900) suppresses the notification, not the incident, when the same rule and labels fire again within that time of the previous resolve. Raise it for a rule that flaps.
- **`notifyChannels`** restricts the rule to some notification channels (`email`, `browser`, `push`); an empty list uses each recipient's preferences.
- **`webhook`** controls whether `alerts.alert.fired` and `alerts.alert.resolved` are also emitted to system webhook endpoints ([webhooks.md](webhooks.md)).

```bash
appctl api PATCH /api/admin/alerts/rules/<id> --data '{ "forSeconds": 600, "cooldownSeconds": 3600 }'
```

## 7. When telemetry is off

A `metric_threshold` or `verdict` rule cannot be evaluated while telemetry is off or the store is unreachable. Its `lastError` says so, and its open incidents are left as they were: they neither fire nor resolve. `node_event` and `node_offline` rules are not affected. To be told about the outage, enable `telemetry.unavailable`; it fires after three minutes of failed probes. Turn telemetry on in `/admin/settings/telemetry` ([telemetry.md](telemetry.md)).

## 8. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| A rule never fires | Disabled, or its condition does not hold | Check `enabled`, `lastEvaluatedAt` and `lastError`; run the test route |
| `lastError` mentions the telemetry store | Telemetry off or unreachable | [§7](#7-when-telemetry-is-off) |
| Fired but nobody was notified | Inside the cooldown after the previous resolve, a restricted `notifyChannels`, or the holders muted the event | Check cooldown, channels and preferences |
| The test route returns no observations | The metric name resolves to no table, or no series match the filters | Confirm the metric in the Explorer; remove filters |
| An alert stays firing after the node recovered | A `node_event` rule has no `recovery` event and `resolveAfterSeconds` has not passed | Add a `recovery`, or lower `resolveAfterSeconds` |
| Delete answers `409 ALERT_STARTER_RULE_PROTECTED` | Starter rules cannot be deleted | Disable it |
| Alerts are not evaluated at all | The job queue is not running | Check Jobs for `alerts.evaluate` and the Doctor |

## 9. Summary checklist

- [ ] Notification channels (email, push) configured and `alerts:read` holders know to expect alerts
- [ ] Starter rules for your goals dry-run, then enabled
- [ ] Custom metric rules created disabled, dry-run, then enabled
- [ ] `forSeconds`, `cooldownSeconds` and channels tuned after the first noisy week
- [ ] `telemetry.unavailable` enabled if any metric or verdict rule is
- [ ] Incidents acknowledged as people take them

## See also

- [Spec](../specs/alerts.md), [slice README](../../packages/platform-api/src/alerts/README.md)
- [Telemetry](telemetry.md), [Run worker nodes](run-worker-nodes.md), [Webhooks](webhooks.md), [Admin guide: Alerts](../ADMIN-GUIDE.md#alerts)
