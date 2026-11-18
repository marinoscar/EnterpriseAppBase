import { Inject, Injectable, Logger } from '@nestjs/common';
import type { AlertObservation } from '@marinoscar/platform-contract/alerts';

import { PLATFORM_PRISMA } from '../core/index';
import { AlertContextService } from './alerts-context.service';
import { AlertsDispatchService } from './alerts-dispatch.service';
import { ALERTS_OPTIONS } from './alerts.constants';
import { AlertStoreUnavailableError } from './alerts.errors';
import type { ResolvedAlertsModuleOptions } from './alerts.options';
import type { AlertNodeEventPayload, AlertRuleView } from './alerts.types';
import type { AlertIncidentRow, AlertRuleRow, AlertsPrisma } from './data/alerts-db';
import { alertRuleKindRegistry } from './kinds/alert-kind.registry';
import { labelsKeyOf, nextTransition, shouldNotify } from './state/alert-state-machine';

/**
 * What one rule's evaluation did.
 *
 * @stability experimental
 */
export interface AlertEvaluationOutcome {
  /** The rule. */
  readonly ruleId: string;
  /** `ok`, or `error` (the kind failed, timed out or is not registered; incidents were left alone). */
  readonly status: 'ok' | 'error';
  /** The error message when `status` is `error`. */
  readonly error: string | null;
  /** Incidents created. */
  readonly opened: number;
  /** Incidents that moved to firing (now or on creation). */
  readonly fired: number;
  /** Incidents that resolved. */
  readonly resolved: number;
}

/**
 * Whether `error` is a unique-constraint violation (Prisma `P2002`).
 *
 * @param error - what a write threw.
 * @returns whether it is `P2002`.
 *
 * @stability experimental
 */
export function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 500);
}

function clampSummary(text: string): string {
  return text.length > 500 ? `${text.slice(0, 499)}…` : text;
}

/**
 * Runs the enabled rules: evaluates each kind, isolates failures per rule,
 * then applies the state machine to the observations. Evaluation is
 * IDEMPOTENT: two passes over the same data leave one incident (the partial
 * unique index arbitrates a race), and every state change is a conditional
 * write so a concurrent pass cannot dispatch the same transition twice.
 *
 * It never opens a transaction, so a dispatch always follows a committed write.
 *
 * @stability experimental
 */
@Injectable()
export class AlertsEvaluationService {
  private readonly logger = new Logger(AlertsEvaluationService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: AlertsPrisma,
    private readonly contexts: AlertContextService,
    private readonly dispatcher: AlertsDispatchService,
    @Inject(ALERTS_OPTIONS) private readonly options: ResolvedAlertsModuleOptions,
  ) {}

  /**
   * Evaluates every enabled rule (or only the event-driven ones that `event`
   * can change).
   *
   * @param scope - `{ event }` restricts to rules of event-driven kinds whose kind says the event matters.
   * @returns one outcome per rule evaluated.
   */
  async evaluateEnabled(scope: { event?: AlertNodeEventPayload } = {}): Promise<AlertEvaluationOutcome[]> {
    const rules = await this.prisma.alertRule.findMany({ where: { enabled: true }, orderBy: { createdAt: 'asc' } });
    const outcomes: AlertEvaluationOutcome[] = [];

    for (const rule of rules) {
      if (scope.event) {
        const kind = alertRuleKindRegistry.get(rule.kind);
        if (!kind?.eventDriven) continue;
        const config = kind.configSchema.safeParse(rule.config);
        if (!config.success || (kind.matchesEvent && !kind.matchesEvent(config.data, scope.event))) continue;
      }
      outcomes.push(await this.evaluateRule(rule));
    }
    return outcomes;
  }

  /**
   * Evaluates one rule and applies its observations. Never throws: a failure
   * is recorded on the rule (`lastError`) and returned.
   *
   * @param rule - the rule row.
   * @param now - the instant (a test seam).
   * @returns what happened.
   */
  async evaluateRule(rule: AlertRuleRow, now: Date = new Date()): Promise<AlertEvaluationOutcome> {
    let observations: AlertObservation[];
    try {
      observations = await this.observe(rule, now);
    } catch (error) {
      if (error instanceof AlertStoreUnavailableError) {
        this.logger.warn(`Alert rule "${rule.name}" (${rule.id}): ${error.message}`);
      } else {
        this.logger.error(`Alert rule "${rule.name}" (${rule.id}) failed: ${message(error)}`);
      }
      await this.stamp(rule.id, now, message(error));
      return { ruleId: rule.id, status: 'error', error: message(error), opened: 0, fired: 0, resolved: 0 };
    }

    try {
      const counts = await this.apply(rule, observations, now);
      await this.stamp(rule.id, now, null);
      return { ruleId: rule.id, status: 'ok', error: null, ...counts };
    } catch (error) {
      this.logger.error(`Alert rule "${rule.name}" (${rule.id}) could not apply its observations: ${message(error)}`);
      await this.stamp(rule.id, now, message(error));
      return { ruleId: rule.id, status: 'error', error: message(error), opened: 0, fired: 0, resolved: 0 };
    }
  }

  /**
   * Evaluates a rule WITHOUT touching state or dispatching: the dry run behind
   * `POST /rules/:id/test`.
   *
   * @param rule - the rule row.
   * @param now - the instant.
   * @returns the observations.
   * @throws whatever the kind throws (the caller reports it).
   */
  observe(rule: AlertRuleRow, now: Date = new Date()): Promise<AlertObservation[]> {
    const kind = alertRuleKindRegistry.get(rule.kind);
    if (!kind) return Promise.reject(new Error(`The alert rule kind "${rule.kind}" is not registered.`));
    const parsed = kind.configSchema.safeParse(rule.config);
    if (!parsed.success) return Promise.reject(new Error(`The rule's config no longer matches the "${rule.kind}" kind.`));

    const controller = new AbortController();
    const view: AlertRuleView = {
      id: rule.id,
      key: rule.key,
      name: rule.name,
      severity: rule.severity as AlertRuleView['severity'],
      kind: rule.kind,
      config: parsed.data,
    };
    const ctx = this.contexts.create(controller.signal, now);

    let timer: NodeJS.Timeout | undefined;
    const budget = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        controller.abort(new Error('time budget spent'));
        reject(new Error(`Evaluation took longer than ${this.options.evaluationBudgetMs} ms and was abandoned.`));
      }, this.options.evaluationBudgetMs);
      timer.unref?.();
    });

    return Promise.race([kind.evaluate(ctx, view), budget]).finally(() => clearTimeout(timer));
  }

  private async stamp(ruleId: string, now: Date, lastError: string | null): Promise<void> {
    try {
      await this.prisma.alertRule.updateMany({ where: { id: ruleId }, data: { lastEvaluatedAt: now, lastError } });
    } catch (error) {
      this.logger.warn(`Could not record the evaluation of rule ${ruleId}: ${message(error)}`);
    }
  }

  private async apply(
    rule: AlertRuleRow,
    observations: readonly AlertObservation[],
    now: Date,
  ): Promise<{ opened: number; fired: number; resolved: number }> {
    const byKey = new Map<string, AlertObservation>();
    for (const observation of observations) {
      const key = labelsKeyOf(observation.labels);
      const existing = byKey.get(key);
      // One observation per label set; a breached one wins over a clear one.
      if (!existing || (observation.breached && !existing.breached)) byKey.set(key, observation);
    }

    const open = await this.prisma.alertIncident.findMany({ where: { ruleId: rule.id, state: { in: ['pending', 'firing'] } } });
    const openByKey = new Map(open.map((incident) => [incident.labelsKey, incident]));
    const counts = { opened: 0, fired: 0, resolved: 0 };

    for (const key of new Set([...byKey.keys(), ...openByKey.keys()])) {
      const incident = openByKey.get(key) ?? null;
      const observation = byKey.get(key) ?? null;
      const transition = nextTransition({
        now,
        open: incident ? { id: incident.id, state: incident.state as 'pending' | 'firing', pendingSince: incident.pendingSince } : null,
        observation,
        forSeconds: rule.forSeconds,
      });

      const touch = {
        severity: rule.severity,
        lastValue: observation?.value ?? null,
        lastSeenAt: now,
        ...(observation ? { summary: clampSummary(observation.summary) } : {}),
      };

      switch (transition.type) {
        case 'none':
          break;
        case 'touch':
          await this.prisma.alertIncident.updateMany({ where: { id: incident!.id, state: { in: ['pending', 'firing'] } }, data: touch });
          break;
        case 'discard':
          await this.prisma.alertIncident.deleteMany({ where: { id: incident!.id, state: 'pending' } });
          break;
        case 'open': {
          const created = await this.create(rule, key, observation!, transition.state ?? 'pending', now);
          if (!created) break; // a concurrent pass created it; the next pass handles it
          counts.opened += 1;
          if (transition.state === 'firing') {
            counts.fired += 1;
            await this.fired(rule, created);
          }
          break;
        }
        case 'promote': {
          const promoted = await this.prisma.alertIncident.updateMany({
            where: { id: incident!.id, state: 'pending' },
            data: { ...touch, state: 'firing', firedAt: now },
          });
          if (promoted.count !== 1) break;
          counts.fired += 1;
          const row = await this.prisma.alertIncident.findUnique({ where: { id: incident!.id } });
          if (row) await this.fired(rule, row);
          break;
        }
        case 'resolve': {
          const previous = await this.previousResolvedAt(rule.id, key);
          const resolved = await this.prisma.alertIncident.updateMany({
            where: { id: incident!.id, state: 'firing' },
            data: {
              state: 'resolved',
              resolvedAt: now,
              severity: rule.severity,
              ...(observation ? { summary: clampSummary(observation.summary), lastValue: observation.value } : {}),
            },
          });
          if (resolved.count !== 1) break;
          counts.resolved += 1;
          const row = await this.prisma.alertIncident.findUnique({ where: { id: incident!.id } });
          if (row) {
            const notify = shouldNotify(row.firedAt ?? now, previous, rule.cooldownSeconds);
            await this.dispatcher.dispatch('resolved', rule, row, notify);
          }
          break;
        }
      }
    }
    return counts;
  }

  private async create(
    rule: AlertRuleRow,
    labelsKey: string,
    observation: AlertObservation,
    state: 'pending' | 'firing',
    now: Date,
  ): Promise<AlertIncidentRow | null> {
    try {
      return await this.prisma.alertIncident.create({
        data: {
          ruleId: rule.id,
          labelsKey,
          labels: observation.labels,
          state,
          severity: rule.severity,
          pendingSince: now,
          firedAt: state === 'firing' ? now : null,
          lastValue: observation.value,
          lastSeenAt: now,
          summary: clampSummary(observation.summary),
        },
      });
    } catch (error) {
      if (isUniqueViolation(error)) return null; // alert_incidents_open_uniq_idx: one open incident per rule and labels
      throw error;
    }
  }

  private async fired(rule: AlertRuleRow, incident: AlertIncidentRow): Promise<void> {
    const previous = await this.previousResolvedAt(rule.id, incident.labelsKey);
    await this.dispatcher.dispatch('fired', rule, incident, shouldNotify(incident.firedAt ?? new Date(), previous, rule.cooldownSeconds));
  }

  private async previousResolvedAt(ruleId: string, labelsKey: string): Promise<Date | null> {
    const row = await this.prisma.alertIncident.findFirst({
      where: { ruleId, labelsKey, state: 'resolved' },
      orderBy: { resolvedAt: 'desc' },
      select: { resolvedAt: true },
    });
    return row?.resolvedAt ?? null;
  }
}
