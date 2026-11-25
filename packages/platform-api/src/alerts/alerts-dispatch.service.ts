import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ALERT_PERMISSIONS, ALERT_WEBHOOK_EVENTS, type AlertWebhookData } from '@marinoscar/platform-contract/alerts';

import { NotificationsService } from '../notifications/index';
import {
  ALERTS_WEBHOOK_EMITTER,
  ALERT_FIRED_NOTIFICATION,
  ALERT_RESOLVED_NOTIFICATION,
} from './alerts.constants';
import { AlertsMetrics } from './alerts.metrics';
import type { AlertsWebhookEmitter } from './alerts.types';
import type { AlertIncidentRow, AlertRuleRow } from './data/alerts-db';
import type { AlertNotificationData } from './notifications/alerts.notifications';

/**
 * One webhook event the slice emits.
 *
 * @stability experimental
 */
export interface AlertWebhookEventDef {
  /** The event key. */
  readonly key: string;
  /** The label a webhooks catalog shows. */
  readonly label: string;
  /** One sentence on when it is emitted. */
  readonly description: string;
}

/**
 * The webhook event keys the slice emits, with the labels a webhooks slice
 * shows in its catalog.
 *
 * @stability experimental
 */
export const ALERT_WEBHOOK_EVENT_DEFS: readonly AlertWebhookEventDef[] = [
  { key: ALERT_WEBHOOK_EVENTS.FIRED, label: 'Alert fired', description: 'An alert rule started firing.' },
  { key: ALERT_WEBHOOK_EVENTS.RESOLVED, label: 'Alert resolved', description: 'A firing alert cleared.' },
];

function labelsOf(incident: AlertIncidentRow): Record<string, string> {
  const raw = incident.labels;
  return raw && typeof raw === 'object' ? (raw as Record<string, string>) : {};
}

/**
 * Sends the two things a fired or resolved incident causes: the notification
 * to the holders of `alerts:read` and the optional webhook. Called AFTER the
 * incident write committed (the evaluator never opens a transaction), and it
 * never throws: a failed dispatch is logged and the incident stands.
 *
 * @stability experimental
 */
@Injectable()
export class AlertsDispatchService {
  private readonly logger = new Logger(AlertsDispatchService.name);

  constructor(
    private readonly metrics: AlertsMetrics,
    @Optional() private readonly notifications?: NotificationsService,
    @Optional() @Inject(ALERTS_WEBHOOK_EMITTER) private readonly webhooks?: AlertsWebhookEmitter,
    @Optional() private readonly config?: ConfigService,
  ) {
    try {
      this.webhooks?.registerEvents?.(ALERT_WEBHOOK_EVENT_DEFS);
    } catch (error) {
      this.logger.warn(`The webhook emitter refused the alert events: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Dispatches one transition.
   *
   * @param to - `fired` or `resolved`.
   * @param rule - the rule.
   * @param incident - the incident as just written.
   * @param notify - whether the notification is sent (false inside a cooldown); the webhook and the metric follow the transition regardless.
   */
  async dispatch(to: 'fired' | 'resolved', rule: AlertRuleRow, incident: AlertIncidentRow, notify: boolean): Promise<void> {
    this.metrics.transition(to, incident.severity);
    if (notify) this.notify(to, rule, incident);
    await this.emitWebhook(to, rule, incident);
  }

  private notify(to: 'fired' | 'resolved', rule: AlertRuleRow, incident: AlertIncidentRow): void {
    if (!this.notifications) return;
    try {
      const appUrl = this.config?.get<string>('appUrl');
      const data: AlertNotificationData = {
        incidentId: incident.id,
        ruleId: rule.id,
        ruleName: rule.name,
        severity: incident.severity,
        state: to,
        summary: incident.summary,
        labels: labelsOf(incident),
        value: incident.lastValue,
        firedAt: incident.firedAt,
        resolvedAt: incident.resolvedAt,
        ...(appUrl ? { appUrl: appUrl.replace(/\/+$/, '') } : {}),
      };
      void this.notifications
        .notifyPermissionHolders(
          to === 'fired' ? ALERT_FIRED_NOTIFICATION : ALERT_RESOLVED_NOTIFICATION,
          ALERT_PERMISSIONS.READ,
          data,
          rule.notifyChannels.length > 0 ? { channels: rule.notifyChannels } : undefined,
        )
        .catch((error: unknown) => {
          this.logger.error(`Dispatching the '${to}' alert notification for incident ${incident.id} rejected: ${error instanceof Error ? error.message : String(error)}`);
        });
    } catch (error) {
      this.logger.error(`Could not raise the '${to}' alert notification for incident ${incident.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async emitWebhook(to: 'fired' | 'resolved', rule: AlertRuleRow, incident: AlertIncidentRow): Promise<void> {
    if (!this.webhooks || !rule.webhook) return;
    try {
      const data: AlertWebhookData = {
        incidentId: incident.id,
        rule: { id: rule.id, key: rule.key, name: rule.name, kind: rule.kind, severity: rule.severity as AlertWebhookData['rule']['severity'] },
        labels: labelsOf(incident),
        value: incident.lastValue,
        summary: incident.summary,
        firedAt: incident.firedAt ? incident.firedAt.toISOString() : null,
        resolvedAt: incident.resolvedAt ? incident.resolvedAt.toISOString() : null,
      };
      await this.webhooks.emit(to === 'fired' ? ALERT_WEBHOOK_EVENTS.FIRED : ALERT_WEBHOOK_EVENTS.RESOLVED, data, { orgId: null });
    } catch (error) {
      this.logger.error(`Could not emit the '${to}' alert webhook for incident ${incident.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
