# @marinoscar/platform-api/alerts

The alerts slice (issue #1047, epic #1044): alert rules over telemetry metrics, worker-node events and fleet health; incidents with a `pending`, `firing` and `resolved` state machine; a notification to the holders of `alerts:read` and an optional webhook on every transition; and the admin routes under `/api/admin/alerts`. It depends on `core`, `doctor`, `otel-core`, `identity`, `jobs`, `nodes`, `telemetry`, `notifications`, `email` and `testing` (`packages/platform-slices.json`); the webhooks slice is NOT a dependency, it plugs in through an optional port.

## Purpose and scope

An administrator turns on a rule and is told when it starts and stops being true, without watching a dashboard.

| Part | Source | What it is |
|---|---|---|
| Module | `alerts.module.ts`, `alerts.options.ts` | `AlertsModule.forRoot(options)`: the services, the controller, the handlers, the two crons and the node-event listener. |
| Kinds | `kinds/` | The rule-kind registry (`registerAlertRuleKind`) and the five built-in kinds: `metric_threshold`, `node_event`, `verdict`, `node_offline`, `telemetry_unavailable`. |
| State machine | `state/alert-state-machine.ts` | Pure: the next transition for an open incident and an observation, the cooldown rule and the label-set key. |
| Evaluation | `alerts-evaluation.service.ts`, `alerts-context.service.ts` | Evaluates each enabled rule with a time budget, isolates failures per rule, applies the state machine with conditional writes. Never opens a transaction. |
| Dispatch | `alerts-dispatch.service.ts`, `notifications/` | After the write: `alerts.alert_fired` / `alerts.alert_resolved` notifications (email, bell, push) and the optional `ALERTS_WEBHOOK_EMITTER`. |
| Jobs | `handlers/`, `tasks/`, `alerts-event.listener.ts` | `alerts.evaluate` (cron, every minute), `alerts.evaluate_event` (one node event) and `alerts.incidents_purge` (daily), all server-only. The cron and the listener only enqueue. |
| Starter rules | `starter-rules.ts`, `alerts-seed.service.ts` | Eight rules, seeded disabled by a stable key and never overwritten. |
| Routes | `alerts-admin.controller.ts` | Rules CRUD, dry-run test, kind catalog, incidents, acknowledge and the summary. |
| Metrics | `alerts.metrics.ts` | `app.alerts.transitions` and `app.alerts.firing` (`ALERTS_APP_METRICS`). |
| Test seams | `testing/` (`/alerts/testing`) | The `alerts` conformance suite, an in-memory Prisma, a scripted kind and a fake evaluation context. |

Rules are DEPLOYMENT-level in v1 (`org_id` is reserved, always `NULL`; the two tables carry no row-level security because a rule watches deployment telemetry).

Not here: the pages (`@marinoscar/platform-web/alerts`, a later change), webhook delivery (`@marinoscar/platform-api/webhooks`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-api`; import it by its subpath:

```ts
import { AlertsModule, ALERTS_NOTIFICATIONS, registerAlertsEmailTemplates } from '@marinoscar/platform-api/alerts';
```

Beyond the package's peers (`@nestjs/common`, `@nestjs/config`, `@nestjs/event-emitter`, `@nestjs/schedule`, `@nestjs/swagger`, `@opentelemetry/api`, `nestjs-zod`, `zod`), the slice needs from the app: core's `PlatformHostModule` (`PLATFORM_PRISMA`), the jobs module (`JobsService`, `JobHandlerRegistry`) in `imports`, the notifications and email slices, the nodes slice's tables, the composed `alerts` fragment of `@marinoscar/platform-db` (migration `0040_add_alerts`) and, for the metric and verdict kinds, the configured telemetry module in `imports`.

## Quick start

The reference app's binding ([`alerts.config.ts`](../../../../apps/api/src/platform/alerts/alerts.config.ts)):

```ts
export const AlertsModule = PlatformAlertsModule.forRoot({ imports: [JobsModule, TelemetryModule] });
```

and, in the app's manifests (before the application bootstraps):

```ts
registerAlertsEmailTemplates();
registerNotifications(ALERTS_NOTIFICATIONS);
registerAppMetrics([...PLATFORM_APP_METRICS, ...ALERTS_APP_METRICS]);
```

A custom rule kind is one registration at import time:

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

## Configuration

`AlertsModule.forRoot(options)`:

| Option | Type | Default | Meaning |
|---|---|---|---|
| `tasks.evaluate` | `boolean` | `true` | This process queues `alerts.evaluate` every minute |
| `tasks.purge` | `boolean` | `true` | This process queues `alerts.incidents_purge` daily |
| `incidentRetentionDays` | `number` | `90` | Days a RESOLVED incident is kept (1 to 3650) |
| `evaluationBudgetMs` | `number` | `20000` | Time one rule may take before it is abandoned (1000 to 110000) |
| `seedStarterRules` | `boolean` | `true` | Seed the disabled starter rules at start |
| `imports` | `AlertsImport[]` | `[]` | Modules the slice needs: the jobs module and the configured telemetry module |

Rules themselves are data (the `alert_rules` table), edited in the UI or the API, never in configuration. There is no environment variable.

## Extension-point catalog

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

| Name | Kind | Signature | When to use | Stability | Example |
|---|---|---|---|---|---|
| `AlertsModule.forRoot` | option | `forRoot(options?: AlertsModuleOptions): DynamicModule` | Mount the slice once, with the jobs and telemetry modules | experimental | [example](../../../../apps/api/src/platform/alerts/alerts.config.ts) |
| `AlertRuleKind` | registry | `{ id, label, description, configSchema, evaluate(ctx, rule), describe(rule), eventDriven?, matchesEvent? }` | The shape of a rule kind: validate a config, observe label sets, describe the rule | experimental | [example](../../../../apps/api/test/alerts/alerts-extension.spec.ts) |
| `AlertsModuleOptions` | option | `{ tasks?, incidentRetentionDays?, evaluationBudgetMs?, seedStarterRules?, imports? }` | The options of `forRoot`: which crons run here, retention, the per-rule time budget, seeding | experimental | [example](../../../../apps/api/src/platform/alerts/alerts.config.ts) |
| `registerAlertRuleKind` | registry | `registerAlertRuleKind<C>(kind: AlertRuleKind<C>): void` | Add a rule kind (a new thing to watch) without editing the package; the id is permanent | experimental | [example](../../../../apps/api/test/alerts/alerts-extension.spec.ts) |
| `alertRuleKindRegistry` | registry | `Registry<AlertRuleKind>` | List the kinds, or read one in a test | experimental | [example](../../../../apps/api/test/alerts/alerts-extension.spec.ts) |
| `ALERTS_WEBHOOK_EMITTER` | token | `unique symbol` -> `AlertsWebhookEmitter` | Bind the optional webhook port to an emitter (the webhooks slice or your own) | experimental | [example](../../../../apps/api/src/platform/alerts/alerts.config.ts) |
| `AlertsWebhookEmitter` | token | `{ emit(eventKey, data, ctx: { orgId: string \| null }): Promise<void>; registerEvents?(events): void }` | Implement the webhook port | experimental | [example](../../../../apps/api/src/platform/alerts/alerts.config.ts) |
| `ALERTS_NOTIFICATIONS` | registry | `readonly NotificationRegistration[]` | Register the two alert notification events with the app's notification manifest | experimental | [example](../../../../apps/api/src/platform/notifications/notification.manifest.ts) |
| `alertsConformanceSuite` | registry | `ConformanceSuite<AlertsConformanceOptions>` | Run the slice's invariants in the app through `runPlatformConformance({ suites: { alerts } })` | experimental | [example](../../../../apps/api/test/conformance.spec.ts) |

Supporting exports (experimental): `AlertRuleKind`, `AlertEvaluationContext`, `AlertRuleView`, `AlertObservation`, `AlertStoreUnavailableError`, `AlertConfigError`, the five built-in kinds and `registerBuiltinAlertKinds`, `nextTransition`, `shouldNotify`, `labelsKeyOf`, the services (`AlertsRulesService`, `AlertsIncidentsService`, `AlertsEvaluationService`, `AlertContextService`, `AlertsDispatchService`, `AlertsSeedService`), the handlers, tasks and listener, `STARTER_ALERT_RULES`, the DTO classes, `ALERTS_APP_METRICS`, `ALERTS_PERMISSIONS`, the job type and notification event strings, and the structural database types (`AlertsPrisma`, `AlertRuleRow`, `AlertIncidentRow`).

## Data

Two tables of the `alerts` fragment (migration `0040_add_alerts`), no row-level security:

- `alert_rules`: `key` (unique, set only on a starter rule), `kind`, `severity`, `config` (JSON, validated by the kind), `for_seconds`, `cooldown_seconds`, `notify_channels`, `webhook`, `enabled` (default false), `last_evaluated_at`, `last_error`, and the reserved `org_id`.
- `alert_incidents`: `rule_id` (cascade), `labels_key` (canonical sorted `k=v,k=v`), `labels`, `state`, the times, `last_value`, `summary` and the acknowledgement.

`alert_incidents_open_uniq_idx ON alert_incidents (rule_id, labels_key) WHERE state IN ('pending','firing')` is a raw-SQL partial unique index, intentional schema drift listed in `raw-sql-indexes.json`: one open incident per rule and label set. The evaluator creates and treats the unique violation as "already open"; never replace it with a pre-check. `created_by_id` and `acknowledged_by_id` are plain ids with no foreign key, so deleting a user keeps alert history.

## Permissions and settings

Declares `alerts:read` and `alerts:write` (`ALERTS_PERMISSIONS`, system scope, granted to `admin`); every route enforces exactly one with `@Auth`: GET routes `alerts:read`, every other `alerts:write`. No system setting.

## UI

None in this package. The pages (rules, incidents, the editor and a dashboard banner) are `@marinoscar/platform-web/alerts`.

## Infra

None. The evaluation runs as a queue job on a worker slot; no environment variable and no compose change.

## Observability

`app.alerts.transitions` (counter; `to` = `fired` or `resolved`, and the severity) and `app.alerts.firing` (gauge by severity), declared by `ALERTS_APP_METRICS`: register them with `registerAppMetrics`. Neither carries a rule name or a label value. The evaluator logs a failed rule with its id; `alert_rules.last_error` shows it in the API. Metric reads go through the guarded telemetry facade as source `alert` (only failures leave an audit row).

## Security notes

A `metric_threshold` rule never reaches SQL as text: every column goes through `ident` after being checked against the resolved table, every filter value through `literal`, the window through `timestamp`, and the facade's SQL guard still applies. A rule's config is validated against its kind on every write. Alert rules and incidents are administrator data: the routes need `alerts:read`/`alerts:write`, and a notification goes to the holders of `alerts:read` only. All alert jobs are server-only: they read the telemetry store and send notifications, none of which a node may do. The webhook payload carries the rule, the labels, the value and the summary, never a credential.

## Conformance suite

`alerts` (`@marinoscar/platform-api/alerts/testing`, run through `runPlatformConformance({ suites: { alerts: { rawSqlIndexNames } } })`): every route is authenticated, never public and requires exactly `alerts:read` (GET) or `alerts:write`; the built-in kinds are registered and every starter rule is valid and seeded disabled; the one-open-incident index is on the raw-SQL list; nothing opens a transaction around a dispatch and the listener does no I/O; two evaluations leave one incident; the notification is raised after the incident is firing; seeding never overwrites an edit. The platform suites `cron-enqueue-only` (the two tasks) and `on-event-no-io` also cover it.

## Upgrade notes

New in #1047. Apply migration `0040_add_alerts`, add `AlertsModule.forRoot` to the app, register the email templates, the notifications and the metrics, and grant nothing further: `admin` holds both permissions.

## Troubleshooting

- **A rule never fires.** Check `lastEvaluatedAt` and `lastError` on the rule (`GET /api/admin/alerts/rules`) and run `POST /rules/:id/test`: it returns the observations without storing anything.
- **`lastError` says the telemetry store is unavailable.** Metric and verdict rules cannot be evaluated while telemetry is off or unreachable; their incidents are left as they were. Enable the `telemetry.unavailable` starter rule to be told.
- **A fire was recorded but nobody was notified.** It fell inside the rule's `cooldownSeconds` after the previous resolve, or the holders have the event muted in their notification preferences.
- **The metric has no table.** The store names a table after the metric with a unit suffix (`_total`, `_bytes`); the rule accepts the dotted name or the table name.

## Links

- Contract: [@marinoscar/platform-contract/alerts](../../../platform-contract/src/alerts/README.md). Web: `@marinoscar/platform-web/alerts`.
- Neighbours: [telemetry](../telemetry/README.md), [nodes](../nodes/README.md), [notifications](../notifications/README.md), [jobs handlers](../jobs/handlers/README.md).
- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md).
