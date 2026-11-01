# Alerts

> **Status:** shipped · **Code:** `@marinoscar/platform-api/alerts` (`packages/platform-api/src/alerts/`), bound by `apps/api/src/platform/alerts/alerts.config.ts`; wire schemas `@marinoscar/platform-contract/alerts` (`packages/platform-contract/src/alerts/`); schema `packages/platform-db/schema/alerts.prisma` (migration `0040_add_alerts`) · **API:** `/api/admin/alerts/*` (see `/api/docs`) · **Admin UI:** the Alerts page of `@marinoscar/platform-web/alerts` (Observability group) · **Runbook:** [alerts.md](../runbooks/alerts.md) · **Recipe:** [§4](#4-extending-it-in-a-fork)

Alerts tell an administrator when something starts and stops being wrong, without a dashboard open. An administrator enables a rule (a metric threshold, a worker-node event, a node going offline, the telemetry verdict); a job evaluates every enabled rule each minute; an incident moves through `pending`, `firing` and `resolved`; and each transition notifies the holders of `alerts:read` and optionally emits a webhook.

## 1. Purpose

**What it is.** Rules as data, a pure incident state machine, and a dispatch that runs only after the incident write commits. A fork gets eight disabled starter rules (laptops on battery, CPU, memory, offline nodes, job failures, the telemetry verdict) and adds its own rule kinds with one registration.

**What it is not.**

- Not per-organization: rules are deployment-level. `alert_rules.org_id` is reserved and always `NULL`, and the two tables carry no row-level security because a rule watches deployment telemetry.
- Not a paging or on-call system: there is no escalation, silence schedule or routing tree. The channels are the notification channels and the optional webhook.
- Not a metrics store: metric rules read the telemetry store ([telemetry.md](telemetry.md)) through its guarded query facade.

## 2. How it works

### 2.1 Rule kinds

Kinds are an open registry (`registerAlertRuleKind`); a kind's `id` is permanent once rules use it. Five are built in:

| Kind | Watches | Labels | Needs the telemetry store |
|---|---|---|---|
| `metric_threshold` | One metric aggregated over a window and compared to a threshold | the `groupBy` attributes | yes |
| `node_event` | Worker-node events (`worker_node_events` table) | `node.id`, `node.name` | no |
| `node_offline` | Nodes that are stale or offline, by the fleet page's freshness rule | `node.id`, `node.name` | no |
| `verdict` | The telemetry dashboard verdict at or past `minLevel` (`degraded` or `critical`), computed in process by the dashboard's own service | none | yes |
| `telemetry_unavailable` | The telemetry store cannot be queried (it probes `SELECT 1`; a failure is the breach) | none | probes it |

**`metric_threshold` config:** `metric`, `aggregation` (`avg`, `max`, `min`, `sum`, `last`, `rate`), `windowSeconds` (60 to 86400), `comparator` (`gt`, `gte`, `lt`, `lte`, `eq`, `neq`), `threshold`, optional `groupBy` (at most 3 attributes) and `filters` (at most 5 of `{ attr, op: eq|neq, value }`).

- The metric name resolves to a table by turning `.` into `_` and trying the name as is and with each of the store's unit suffixes (`_total`, `_bytes`, `_seconds`, `_ratio`, `_percent`); the rule accepts the dotted name or the table name.
- `rate` is the **increase per minute** over the window (counter increases summed per series, divided by the window in minutes), so a threshold of 1 on `app.jobs.settled` means one job per minute on average.
- One SQL statement per rule, built only with the facade's `ident`, `literal` and `timestamp` helpers: every column is checked against the resolved table, every filter value is a literal, and the facade's SQL guard still applies.

**`node_event` config:** `eventTypes` (exact types or a `prefix.*`; 1 to 20), optional `attrs` (the event's attributes that must equal given values, for example `{ to: 'battery' }`), optional `minSeverity`, optional `nodeIds`, optional `recovery` (`{ eventTypes, attrs? }`) and `resolveAfterSeconds` (60 to 604800, default 3600). Per node the **newest** classified event inside `resolveAfterSeconds` decides: a trigger breaches, a recovery event clears, and a node with no such event in the window is clear. It reads the Prisma table, not the telemetry store, so it works with telemetry off.

### 2.2 Starter rules

Eight rules are seeded by a stable `key` when the module starts, all with `enabled = false`. The seeder inserts a missing key and never overwrites an existing row, so an administrator's edits survive upgrades; a starter rule cannot be deleted (`409 ALERT_STARTER_RULE_PROTECTED`), only disabled.

| Key | Kind | Condition | Severity | For |
|---|---|---|---|---|
| `nodes.on_battery` | `node_event` | `power.source_changed` with `to = battery`; recovers on `to = ac`; auto-clears after 24 h | warning | 0 |
| `nodes.battery_low` | `node_event` | `power.battery_low` or `power.battery_critical`; recovers on `power.battery_recovered`; auto-clears after 6 h | warning | 0 |
| `nodes.host_cpu_high` | `metric_threshold` | `app.nodes.host.cpu.utilization` avg over 300 s above 90, grouped by `node_id` | warning | 300 s |
| `nodes.host_memory_low` | `metric_threshold` | `app.nodes.host.memory.available` last over 300 s below 512 MiB, grouped by `node_id` | warning | 300 s |
| `nodes.offline` | `node_offline` | a node is stale or offline | critical | 60 s |
| `jobs.failure_spike` | `metric_threshold` | `app.jobs.settled` rate over 300 s above 1 per minute, filter `outcome = failed` | warning | 0 |
| `telemetry.verdict_critical` | `verdict` | the verdict is `critical` | critical | 120 s |
| `telemetry.unavailable` | `telemetry_unavailable` | the store cannot be queried | warning | 180 s |

All start with cooldown 900 s, no channel restriction and the webhook flag on.

### 2.3 Incidents and the state machine

`alert_incidents` holds one row per rule and label set while it is open. `labels_key` is the canonical identity of the label set (keys sorted, `k=v` joined by `,`, each side percent-encoded; `''` when unlabelled; a key past 512 characters keeps its head and ends in a hash). The pure function `nextTransition` (`state/alert-state-machine.ts`) answers per rule and label set:

| Observation | Open incident | Result |
|---|---|---|
| breached | none | open `firing` when `forSeconds` is 0, else `pending` |
| breached | `pending`, held for `forSeconds` | promote to `firing` (notify) |
| breached | `pending`, not yet | touch |
| breached | `firing` | touch (update value and last seen) |
| clear or absent | none | nothing |
| clear or absent | `pending` | discard (it never fired, so it leaves no history) |
| clear or absent | `firing` | resolve (notify) |

Resolution happens on the **first clean evaluation**; there is no hysteresis. Tame a flapping rule with `forSeconds` and `cooldownSeconds`, not by delaying the resolve.

**One open incident per rule and labels** is enforced by the raw-SQL partial unique index `alert_incidents_open_uniq_idx ON alert_incidents (rule_id, labels_key) WHERE state IN ('pending','firing')`, intentional schema drift listed in `raw-sql-indexes.json`. The evaluator inserts and treats the unique violation as "already open", so two concurrent evaluations leave one incident. Never replace it with a `findFirst` pre-check or an `@@unique`.

**Cooldown** is derived from stored times: a fire is not notified when the same rule and labels resolved less than `cooldownSeconds` before this incident fired (`shouldNotify`). The incident is still recorded. The matching resolve repeats the same decision from the same stored times, so a suppressed fire never produces a lone "resolved".

**Acknowledgement** (`acknowledged_at`, `acknowledged_by_id`) is a mark for people; it does not stop notifications or change the state.

### 2.4 Evaluation

- `alerts.evaluate` (cron every minute, `enqueueHousekeepingJob` with `orgId: null`, deduplicated) loads the enabled rules and evaluates each with a per-rule time budget (`evaluationBudgetMs`, default 20 s). A rule that throws or exceeds its budget records `last_error` and is skipped; the others still run. It stamps `last_evaluated_at` on every rule it evaluated.
- `alerts.evaluate_event` runs when a node reports an event: an `@OnEvent` listener (no I/O) enqueues it with the event, and the handler evaluates only the event-driven (`node_event`) rules, so a power change fires within seconds, not at the next minute.
- `alerts.incidents_purge` (daily, 03:17) deletes **resolved** incidents older than `incidentRetentionDays` (default 90).
- All three are server-only (no `nodeResultSchema`, no `persistNodeResult`): they read the telemetry store and send notifications. The evaluator never opens a transaction.

### 2.5 When telemetry is off or unreachable

A `metric_threshold` or `verdict` rule cannot be evaluated: the facade throws `AlertStoreUnavailableError`, the rule's `last_error` says so, and its open incidents are **left as they are** (not resolved, not fired). `node_event` and `node_offline` rules keep working. The `telemetry.unavailable` starter rule is the way to be told: it breaches when the probe fails and, with its 180 s `forSeconds`, does not flap on a blip. The `unavailable` kind itself cannot be affected by the outage it reports.

### 2.6 The dry run

`POST /rules/:id/test` evaluates the stored rule now and returns the observations (labels, value, breached, summary) with no state change and no dispatch. Use it before enabling a rule.

### 2.7 Data model

`alert_rules` (`key` unique and set only on a starter rule, `kind`, `severity`, `config` JSON validated by the kind on every write, `for_seconds`, `cooldown_seconds`, `notify_channels`, `webhook`, `enabled` default false, `last_evaluated_at`, `last_error`, reserved `org_id`) and `alert_incidents` (`rule_id` cascade, `labels_key`, `labels`, `state`, `severity`, `pending_since`, `fired_at`, `resolved_at`, `last_value`, `last_seen_at`, `summary`, acknowledgement). `created_by_id` and `acknowledged_by_id` are plain ids with no foreign key, so deleting a user keeps alert history. The table inventory is [ARCHITECTURE.md §6.1](../ARCHITECTURE.md#61-prisma-models).

### 2.8 Dispatch

After the incident write commits, outside any transaction:

- **Notifications.** `alerts.alert_fired` and `alerts.alert_resolved` (email, bell and push; critical severity uses the critical-capable channels) go to the holders of `alerts:read` through `notifyPermissionHolders`, restricted to the rule's `notifyChannels` when that list is not empty. Each recipient's own preferences still apply.
- **Webhook.** When the rule's `webhook` flag is on and an `ALERTS_WEBHOOK_EMITTER` is bound, the slice emits `alerts.alert.fired` or `alerts.alert.resolved` with `{ incidentId, rule: { id, key, name, kind, severity }, labels, value, summary, firedAt, resolvedAt }` and `orgId: null` (a system-audience event, so only system endpoints receive it; see [webhooks.md](webhooks.md#22-the-event-catalog)). The port is optional: the alerts slice has no dependency on the webhooks slice and compiles without it. A dispatch failure is logged and never fails the evaluation.
- **Metrics.** `app.alerts.transitions` (counter; `to` = `fired` or `resolved`, and `severity`) and `app.alerts.firing` (gauge of firing incidents by severity). No rule name or label value is a metric label.

## 3. Configuration and permissions

**Options** (`AlertsModule.forRoot`; rules themselves are data, edited in the UI or API; there is no environment variable and no setting):

| Option | Default | Meaning |
|---|---|---|
| `tasks.evaluate` | `true` | This process queues `alerts.evaluate` every minute |
| `tasks.purge` | `true` | This process queues `alerts.incidents_purge` daily |
| `incidentRetentionDays` | 90 | Days a resolved incident is kept (1 to 3650) |
| `evaluationBudgetMs` | 20000 | Time one rule may take (1000 to 110000) |
| `seedStarterRules` | `true` | Seed the disabled starter rules at start |
| `imports` | none | The jobs module and the configured telemetry module |

**Permissions** (system scope, granted to `admin`; every route enforces exactly one: `GET` is `alerts:read`, the rest `alerts:write`; matrix in [ARCHITECTURE.md §7.2](../ARCHITECTURE.md#72-permission-matrix)):

| Route (under `/api/admin/alerts`) | Permission | Purpose |
|---|---|---|
| `GET /rules`, `POST /rules` | read, write | List; create (a new rule is disabled unless `enabled: true`) |
| `GET/PATCH/DELETE /rules/:id` | read, write, write | Read, edit, delete (a starter rule answers 409) |
| `POST /rules/:id/test` | write | Dry run |
| `GET /kinds` | read | Registered kinds with the JSON Schema of their config |
| `GET /incidents`, `GET /incidents/:id` | read | Filter by `state`, `severity`, `ruleId`; paged |
| `POST /incidents/:id/acknowledge` | write | Acknowledge |
| `GET /summary` | read | Firing counts by severity and `lastEvaluatedAt` |

Limits: name 120, description 500, `forSeconds` up to 86400, `cooldownSeconds` up to 604800, at most 8 channels. Errors: `ALERT_RULE_NOT_FOUND`, `ALERT_INCIDENT_NOT_FOUND`, `ALERT_UNKNOWN_KIND`, `ALERT_INVALID_CONFIG`, `ALERT_STARTER_RULE_PROTECTED`.

## 4. Extending it in a fork

Add a kind with one registration at import time; the config schema is validated on every write and the kind appears in `GET /kinds`:

```ts
registerAlertRuleKind({
  id: 'queue_stuck',
  label: 'Queue stuck',
  description: 'Jobs are pending and none is running.',
  configSchema: z.object({}).strict(),
  evaluate: async (ctx) => [{ labels: {}, value: null, breached: false, summary: 'ok' }],
  describe: () => 'Jobs are pending and none is running',
});
```

Bind `ALERTS_WEBHOOK_EMITTER` to an emitter (the webhooks slice's `WebhooksService`, or your own) to get the webhook events; check `apps/api/src/platform/alerts/alerts.config.ts` for what the reference app binds. Everything else (module wiring, the notification and metric registrations, the test kit) is in [packages/platform-api/src/alerts/README.md](../../packages/platform-api/src/alerts/README.md); wire shapes in [packages/platform-contract/src/alerts/README.md](../../packages/platform-contract/src/alerts/README.md). A tested example: `apps/api/test/alerts/alerts-extension.spec.ts`.

## 5. Guardrails

The `alerts` conformance suite (`@marinoscar/platform-api/alerts/testing`, run by `apps/api/test/conformance.spec.ts`):

- every route is authenticated, never public, and requires exactly `alerts:read` (GET) or `alerts:write`.
- the built-in kinds are registered; every starter rule is valid and seeded disabled; seeding never overwrites an edit.
- `alert_incidents_open_uniq_idx` is on the raw-SQL index list.
- two evaluations of the same data leave one incident.
- nothing opens a transaction around a dispatch, the listener does no I/O, and the notification is raised after the incident is firing.
- `cron-enqueue-only` (the two tasks) and `on-event-no-io` (platform suites) cover the crons and the listener.

## 6. Design decisions

- **Deployment-level rules, no RLS.** A rule reads deployment telemetry and fleet state, which belong to no organization; org-scoped rules would need an organization-aware metric facade. `org_id` is reserved so adding them later is not a migration of data.
- **Event-driven path for node events.** A battery or power change is rare and urgent; waiting up to a minute for the cron wastes the signal. Rejected: polling faster, which costs a store query per rule per tick.
- **`node_event` reads Prisma, not GreptimeDB.** Alerts for laptops on battery must work on a deployment that never turned telemetry on.
- **Resolve on the first clean evaluation.** Hysteresis hides real recovery; `forSeconds` and the cooldown already tame flapping, and they are visible settings.
- **Cooldown from stored times, not memory.** The evaluator runs in any process and restarts freely; deriving the decision from `resolved_at` and `fired_at` makes fire and resolve agree without extra state.
- **Dispatch after commit, by port.** The webhook is an optional port so the alerts slice has no hard dependency on the webhooks slice; an incident is never rolled back by a failing receiver.
- **Starter rules ship disabled.** A fresh deployment sends nothing until an administrator decides what is worth a notification.

## 7. Verification

```bash
npx jest --config apps/api/test/jest.config.js --rootDir apps/api test/alerts test/conformance
npm run test:db --workspace=api -- alerts          # the partial unique index against real Postgres
npm run openapi:dump                               # /api/admin/alerts appears
```

By hand: enable the `nodes.offline` starter rule, stop a test node, and observe a `pending` then `firing` incident in `GET /api/admin/alerts/incidents` after 60 s and a notification to `alerts:read` holders; restart the node and observe it `resolved`.

## History

- Epic 1044: observability and integrations for operators.
- Issue 1047: the alerts slice (contract, fragment and migration `0040_add_alerts`, API, starter rules, conformance suite, docs).
