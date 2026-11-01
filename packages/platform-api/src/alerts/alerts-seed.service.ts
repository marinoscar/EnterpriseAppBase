import { Inject, Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../core/index';
import { ALERTS_OPTIONS } from './alerts.constants';
import type { ResolvedAlertsModuleOptions } from './alerts.options';
import type { AlertsPrisma } from './data/alerts-db';
import { isUniqueViolation } from './alerts-evaluation.service';
import { parseAlertConfig } from './kinds/alert-kind.registry';
import { STARTER_ALERT_RULES } from './starter-rules';

/**
 * Seeds the starter rules, disabled, keyed by their stable keys. A rule that
 * exists (by key) is NEVER touched, so an administrator's edits, enabling and
 * thresholds survive every restart and every replica starting at once.
 *
 * @stability experimental
 */
@Injectable()
export class AlertsSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(AlertsSeedService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: AlertsPrisma,
    @Inject(ALERTS_OPTIONS) private readonly options: ResolvedAlertsModuleOptions,
  ) {}

  /** Seeds once the application has bootstrapped; a failure is logged, never thrown. */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.options.seedStarterRules) return;
    try {
      await this.seed();
    } catch (error) {
      this.logger.warn(`Could not seed the starter alert rules: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Creates the missing starter rules.
   *
   * @returns how many were created.
   */
  async seed(): Promise<number> {
    let created = 0;
    for (const { key, rule } of STARTER_ALERT_RULES) {
      if (await this.prisma.alertRule.findUnique({ where: { key } })) continue;
      try {
        await this.prisma.alertRule.create({
          data: { ...rule, key, enabled: false, config: parseAlertConfig(rule.kind, rule.config), description: rule.description ?? null },
        });
        created += 1;
      } catch (error) {
        if (!isUniqueViolation(error)) throw error; // another replica seeded it first
      }
    }
    if (created > 0) this.logger.log(`Seeded ${created} starter alert rule(s), all disabled.`);
    return created;
  }
}
