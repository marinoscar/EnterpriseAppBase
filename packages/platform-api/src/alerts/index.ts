// `@marinoscar/platform-api/alerts`: the alerts slice (issue #1047): rules over
// telemetry metrics, worker-node events and fleet health, incidents and their
// state machine, notifications and optional webhooks on a transition, the
// admin routes under /api/admin/alerts. Documented in ./README.md. Explicit
// named exports only.

export { AlertsModule } from './alerts.module';
export { resolveAlertsModuleOptions } from './alerts.options';
export type { AlertsImport, AlertsModuleOptions, ResolvedAlertsModuleOptions } from './alerts.options';
export {
  ALERTS_EVALUATE_EVENT_TYPE,
  ALERTS_EVALUATE_TYPE,
  ALERTS_INCIDENTS_PURGE_TYPE,
  ALERTS_OPTIONS,
  ALERTS_WEBHOOK_EMITTER,
  ALERT_FIRED_NOTIFICATION,
  ALERT_OPEN_INCIDENT_INDEX,
  ALERT_RESOLVED_NOTIFICATION,
} from './alerts.constants';
export { ALERTS_PERMISSIONS } from './alerts.permissions';
export type { AlertsPermissionDeclaration } from './alerts.permissions';
export { AlertConfigError, AlertStoreUnavailableError } from './alerts.errors';
export type { AlertConfigIssue } from './alerts.errors';
export type {
  AlertEvaluationContext,
  AlertMetricTable,
  AlertNodeEventPayload,
  AlertObservation,
  AlertRuleKind,
  AlertRuleView,
  AlertTelemetryAccess,
  AlertVerdict,
  AlertsWebhookEmitter,
} from './alerts.types';
export { alertRuleKindRegistry, parseAlertConfig, registerAlertRuleKind } from './kinds/alert-kind.registry';
export { BUILTIN_ALERT_KINDS, registerBuiltinAlertKinds } from './kinds/builtin-kinds';
export { metricThresholdKind } from './kinds/metric-threshold.kind';
export { buildMetricThresholdSql, compareValue, resolveMetricTable } from './kinds/metric-threshold.sql';
export { classifyNodeEvent, eventTypeMatches, nodeEventKind } from './kinds/node-event.kind';
export type { NodeEventClassification } from './kinds/node-event.kind';
export { nodeOfflineKind } from './kinds/node-offline.kind';
export { telemetryUnavailableKind } from './kinds/telemetry-unavailable.kind';
export { verdictKind } from './kinds/verdict.kind';
export { labelsKeyOf, nextTransition, shouldNotify } from './state/alert-state-machine';
export type { OpenIncidentState, Transition, TransitionInput, TransitionObservation } from './state/alert-state-machine';
export { AlertContextService, metricTablesOfSchema, toAlertStoreError } from './alerts-context.service';
export { AlertsEvaluationService, isUniqueViolation } from './alerts-evaluation.service';
export type { AlertEvaluationOutcome } from './alerts-evaluation.service';
export { ALERT_WEBHOOK_EVENT_DEFS, AlertsDispatchService } from './alerts-dispatch.service';
export type { AlertWebhookEventDef } from './alerts-dispatch.service';
export { AlertsRulesService, toAlertRule } from './alerts-rules.service';
export { AlertsIncidentsService, toAlertIncident } from './alerts-incidents.service';
export type { AlertIncidentPage, AlertIncidentRule, IncidentWithRule } from './alerts-incidents.service';
export { AlertsSeedService } from './alerts-seed.service';
export { STARTER_ALERT_RULES } from './starter-rules';
export type { StarterAlertRule } from './starter-rules';
export { ALERTS_APP_METRICS, AlertsMetrics } from './alerts.metrics';
export type { AlertsAppMetricDef } from './alerts.metrics';
export { ALERTS_NOTIFICATIONS, ALERT_EMAIL_TEMPLATES, alertBrowserTemplate, alertEmail, registerAlertsEmailTemplates } from './notifications/alerts.notifications';
export type { AlertNotificationData } from './notifications/alerts.notifications';
export { AlertsAdminController } from './alerts-admin.controller';
export { AlertsEventListener } from './alerts-event.listener';
export { AlertsEvaluateHandler } from './handlers/alerts-evaluate.handler';
export { AlertsEvaluateEventHandler } from './handlers/alerts-evaluate-event.handler';
export { AlertsIncidentsPurgeHandler } from './handlers/alerts-incidents-purge.handler';
export { AlertsEvaluateTask } from './tasks/alerts-evaluate.task';
export { AlertsPurgeTask } from './tasks/alerts-purge.task';
export {
  AlertIncidentDto,
  AlertIncidentListQueryDto,
  AlertKindDto,
  AlertRuleDto,
  AlertRuleListQueryDto,
  AlertRuleTestResponseDto,
  AlertSummaryDto,
  CreateAlertRuleDto,
  UpdateAlertRuleDto,
} from './dto/alerts.dto';
export type { AlertIncidentRow, AlertNodeEventRow, AlertNodeRow, AlertRuleRow, AlertsBatchResult, AlertsDelegate, AlertsPrisma, AlertsQueryArgs } from './data/alerts-db';
