# @marinoscar/platform-contract/alerts

The wire contract of the alerts slice (issue #1047): alert rules, the config schemas of the built-in rule kinds, incidents, the dry-run response, the kind catalog, the dashboard summary and the data of the `alerts.alert.*` webhook events, as zod schemas with inferred types and zod-free constants. `@marinoscar/platform-api/alerts` wraps the schemas as DTOs; `@marinoscar/platform-web/alerts` reads the types. It depends on no other slice (`packages/platform-slices.json`).

## Purpose and scope

One definition of what crosses the wire for alerts, so the API's validation, its OpenAPI document and the web client cannot drift.

| Part | Source | What it is |
|---|---|---|
| Constants | `constants.ts` | Zod-free: the two permission strings, severities, incident states, comparators, aggregations, the built-in kind ids, the starter rule keys, the webhook event keys, error codes and the limits. |
| Schemas | `schemas.ts` | Rule (with create, update and list query), the configs of `metric_threshold`, `node_event`, `verdict` and the empty config, incident (with list and query), observation, test response, kind catalog entry, summary and webhook data. |

The kind id of a rule is an OPEN string: the API's registry decides which kinds exist, the contract fixes only its shape and names the built-in ones.

Not here: the kind registry, the evaluation, the state machine, dispatch and the routes (`@marinoscar/platform-api/alerts`), the pages (`@marinoscar/platform-web/alerts`).

## Install and peer dependencies

Ships inside `@marinoscar/platform-contract`; import it by its subpath:

```ts
import { createAlertRuleSchema, ALERT_PERMISSIONS } from '@marinoscar/platform-contract/alerts';
import type { AlertRule, AlertIncident } from '@marinoscar/platform-contract/alerts';
```

None beyond the package's own peer, `zod` (`^4.4.3`). A browser that imports only the constants and the types never bundles `zod`.

## Quick start

```ts
import { createAlertRuleSchema } from '@marinoscar/platform-contract/alerts';

const body = createAlertRuleSchema.parse({
  name: 'Worker CPU high',
  kind: 'metric_threshold',
  severity: 'warning',
  forSeconds: 300,
  config: { metric: 'app.nodes.host.cpu.utilization', aggregation: 'avg', windowSeconds: 300, comparator: 'gt', threshold: 90, groupBy: ['node_id'] },
});
```

The envelope only checks the shape of `config`; the kind's own schema (for the built-in kinds `metricThresholdConfigSchema`, `nodeEventConfigSchema`, `verdictConfigSchema`) validates it in the API.

## Configuration

None. Schemas and constants take no options.

## Extension-point catalog

None. The contract declares shapes; adding a rule kind is `registerAlertRuleKind` in `@marinoscar/platform-api/alerts`.

The extension ladder and a recipe per extension: [docs/EXTENDING.md](../../../../docs/EXTENDING.md).

Supporting exports (experimental): the constants `ALERT_PERMISSIONS`, `ALERT_SEVERITIES`, `ALERT_INCIDENT_STATES`, `ALERT_COMPARATORS`, `ALERT_AGGREGATIONS`, `ALERT_FILTER_OPS`, `ALERT_KIND_IDS`, `ALERT_STARTER_RULE_KEYS`, `ALERT_WEBHOOK_EVENTS`, `ALERT_ERROR_CODES` and the limits and patterns; the schemas `alertRuleSchema`, `createAlertRuleSchema`, `updateAlertRuleSchema`, `alertRuleListQuerySchema`, `alertRuleListSchema`, `metricThresholdConfigSchema`, `nodeEventConfigSchema`, `verdictConfigSchema`, `emptyAlertConfigSchema`, `alertIncidentSchema`, `alertIncidentListQuerySchema`, `alertIncidentListSchema`, `alertObservationSchema`, `alertRuleTestResponseSchema`, `alertKindSchema`, `alertKindListSchema`, `alertSummarySchema`, `alertWebhookDataSchema` and their types.

## Data

None. The contract owns no table.

## Permissions and settings

Declares none. `ALERT_PERMISSIONS` names the strings the API routes enforce, for a client's own checks: `alerts:read` and `alerts:write`.

## UI

None. Types only.

## Infra

None.

## Observability

None.

## Security notes

Alert rules and incidents are administrator data: the schemas carry no secret. `config` is an opaque object here; the API validates it per kind, and `metric_threshold` attribute names are checked against the store's schema before they reach SQL.

## Conformance suite

None. `test/alerts.test.ts` pins the schemas and limits; `test/no-zod-in-constants.test.ts` keeps the constants zod-free.

## Upgrade notes

New in #1047. No earlier shape to migrate from.

## Troubleshooting

- **A rule is refused with 400 `ALERT_INVALID_CONFIG`.** The `config` does not match the kind's schema; `GET /api/admin/alerts/kinds` returns each kind's JSON Schema.

## Links

- API: `@marinoscar/platform-api/alerts`. Web: `@marinoscar/platform-web/alerts`.
- Spec: [platform-packages.md](../../../../docs/specs/platform-packages.md).
