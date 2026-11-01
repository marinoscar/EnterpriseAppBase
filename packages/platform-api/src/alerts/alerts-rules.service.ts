import { ConflictException, Inject, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import {
  ALERT_ERROR_CODES,
  type AlertRule,
  type AlertRuleListQuery,
  type CreateAlertRule,
  type UpdateAlertRule,
} from '@marinoscar/platform-contract/alerts';

import { PLATFORM_PRISMA } from '../core/index';
import { AlertConfigError } from './alerts.errors';
import type { AlertRuleRow, AlertsPrisma } from './data/alerts-db';
import { parseAlertConfig } from './kinds/alert-kind.registry';

/**
 * Maps a rule row (and its open incident count) to the wire shape.
 *
 * @param row - the row.
 * @param openIncidents - incidents pending or firing.
 * @returns the rule.
 *
 * @stability experimental
 */
export function toAlertRule(row: AlertRuleRow, openIncidents: number): AlertRule {
  return {
    id: row.id,
    key: row.key,
    starter: row.key !== null,
    name: row.name,
    description: row.description,
    enabled: row.enabled,
    kind: row.kind,
    severity: row.severity as AlertRule['severity'],
    config: (row.config && typeof row.config === 'object' ? row.config : {}) as Record<string, unknown>,
    forSeconds: row.forSeconds,
    cooldownSeconds: row.cooldownSeconds,
    notifyChannels: row.notifyChannels,
    webhook: row.webhook,
    createdById: row.createdById,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastEvaluatedAt: row.lastEvaluatedAt ? row.lastEvaluatedAt.toISOString() : null,
    lastError: row.lastError,
    openIncidents,
  };
}

function badConfig(error: unknown): never {
  if (error instanceof AlertConfigError) {
    throw new BadRequestException({ message: error.message, details: { reason: error.code, issues: error.issues } });
  }
  throw error;
}

/**
 * Rule CRUD. Config is validated against the kind's schema on every write;
 * starter rules (those with a `key`) can be edited and disabled, not deleted.
 *
 * @stability experimental
 */
@Injectable()
export class AlertsRulesService {
  constructor(@Inject(PLATFORM_PRISMA) private readonly prisma: AlertsPrisma) {}

  /**
   * Lists rules, newest first.
   *
   * @param query - optional kind, severity and enabled filters.
   * @returns the rules.
   */
  async list(query: AlertRuleListQuery = {}): Promise<AlertRule[]> {
    const where = {
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.severity ? { severity: query.severity } : {}),
      ...(query.enabled !== undefined ? { enabled: query.enabled } : {}),
    };
    const rows = await this.prisma.alertRule.findMany({ where, orderBy: [{ createdAt: 'asc' }, { name: 'asc' }] });
    const open = await this.prisma.alertIncident.findMany({
      where: { state: { in: ['pending', 'firing'] }, ruleId: { in: rows.map((r) => r.id) } },
      select: { ruleId: true },
    });
    const counts = new Map<string, number>();
    for (const { ruleId } of open) counts.set(ruleId, (counts.get(ruleId) ?? 0) + 1);
    return rows.map((row) => toAlertRule(row, counts.get(row.id) ?? 0));
  }

  /**
   * One rule.
   *
   * @param id - the rule id.
   * @returns the rule.
   * @throws NotFoundException `ALERT_RULE_NOT_FOUND`.
   */
  async get(id: string): Promise<AlertRule> {
    const row = await this.row(id);
    return toAlertRule(row, await this.openCount(id));
  }

  /**
   * The raw row (for the evaluator and the dry run).
   *
   * @param id - the rule id.
   * @throws NotFoundException `ALERT_RULE_NOT_FOUND`.
   */
  async row(id: string): Promise<AlertRuleRow> {
    const row = await this.prisma.alertRule.findUnique({ where: { id } });
    if (!row) throw new NotFoundException({ message: 'There is no such alert rule.', details: { reason: ALERT_ERROR_CODES.RULE_NOT_FOUND } });
    return row;
  }

  /**
   * Creates a rule.
   *
   * @param body - the validated body.
   * @param userId - the administrator.
   * @returns the rule.
   * @throws BadRequestException `ALERT_UNKNOWN_KIND` or `ALERT_INVALID_CONFIG`.
   */
  async create(body: CreateAlertRule, userId: string | null): Promise<AlertRule> {
    let config: unknown;
    try {
      config = parseAlertConfig(body.kind, body.config);
    } catch (error) {
      badConfig(error);
    }
    const row = await this.prisma.alertRule.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        enabled: body.enabled,
        kind: body.kind,
        severity: body.severity,
        config,
        forSeconds: body.forSeconds,
        cooldownSeconds: body.cooldownSeconds,
        notifyChannels: body.notifyChannels,
        webhook: body.webhook,
        createdById: userId,
      },
    });
    return toAlertRule(row, 0);
  }

  /**
   * Updates a rule. Disabling it closes its open incidents silently.
   *
   * @param id - the rule id.
   * @param body - the validated patch.
   * @returns the rule.
   * @throws NotFoundException `ALERT_RULE_NOT_FOUND`; BadRequestException `ALERT_INVALID_CONFIG`.
   */
  async update(id: string, body: UpdateAlertRule): Promise<AlertRule> {
    const current = await this.row(id);
    const wasEnabled = current.enabled;
    const data: Record<string, unknown> = { ...body };
    if (body.config !== undefined) {
      try {
        data.config = parseAlertConfig(current.kind, body.config);
      } catch (error) {
        badConfig(error);
      }
    }
    const row = await this.prisma.alertRule.update({ where: { id }, data });
    if (wasEnabled && body.enabled === false) await this.closeOpenIncidents(id);
    return toAlertRule(row, await this.openCount(id));
  }

  /**
   * Deletes a rule and, by cascade, its incidents.
   *
   * @param id - the rule id.
   * @throws NotFoundException `ALERT_RULE_NOT_FOUND`; ConflictException `ALERT_STARTER_RULE_PROTECTED` for a starter rule.
   */
  async remove(id: string): Promise<void> {
    const row = await this.row(id);
    if (row.key !== null) {
      throw new ConflictException({
        message: 'A starter rule cannot be deleted; edit it or disable it.',
        details: { reason: ALERT_ERROR_CODES.STARTER_RULE_PROTECTED },
      });
    }
    await this.prisma.alertRule.delete({ where: { id } });
  }

  private openCount(ruleId: string): Promise<number> {
    return this.prisma.alertIncident.count({ where: { ruleId, state: { in: ['pending', 'firing'] } } });
  }

  /** A disabled rule is not evaluated, so nothing would ever resolve its incidents. No notification: the administrator did it. */
  private async closeOpenIncidents(ruleId: string): Promise<void> {
    await this.prisma.alertIncident.deleteMany({ where: { ruleId, state: 'pending' } });
    await this.prisma.alertIncident.updateMany({ where: { ruleId, state: 'firing' }, data: { state: 'resolved', resolvedAt: new Date() } });
  }
}
