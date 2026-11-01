import { Inject, Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import type { BatchObservableResult, ObservableGauge } from '@opentelemetry/api';
import { ALERT_SEVERITIES, type AlertSeverity } from '@marinoscar/platform-contract/alerts';

import { PLATFORM_PRISMA } from '../core/index';
import {
  MetricsHostService,
  createRegisteredGauge,
  type AppGaugeContext,
  type AppMetricDef,
  type AppMetricAttribute,
} from '../otel-core/index';
import type { AlertsPrisma } from './data/alerts-db';

const severity: AppMetricAttribute = { kind: 'enum', values: [...ALERT_SEVERITIES] };

/**
 * One alerts metric's declaration, its `key` a literal.
 *
 * @typeParam Key - the metric's code key.
 * @stability experimental
 */
export interface AlertsAppMetricDef<Key extends string> extends AppMetricDef {
  /** The metric's code key. */
  readonly key: Key;
}

/**
 * The alerts metrics: the `app.alerts.transitions` counter (`to` = `fired` or
 * `resolved`, and the severity) and the `app.alerts.firing` gauge (incidents
 * firing now, by severity). Neither carries a rule or label value.
 * Register with `registerAppMetrics(ALERTS_APP_METRICS)` before the metrics
 * host is built.
 *
 * @example
 * ```ts
 * registerAppMetrics([...PLATFORM_APP_METRICS, ...ALERTS_APP_METRICS]);
 * ```
 *
 * @stability experimental
 */
export const ALERTS_APP_METRICS: readonly [AlertsAppMetricDef<'alertsTransitions'>, AlertsAppMetricDef<'alertsFiring'>] = [
  {
    key: 'alertsTransitions',
    name: 'app.alerts.transitions',
    kind: 'counter',
    unit: '{transition}',
    description: 'Alert incidents that fired or resolved, by direction and severity.',
    attributes: { to: { kind: 'enum', values: ['fired', 'resolved'] }, severity },
  },
  {
    key: 'alertsFiring',
    name: 'app.alerts.firing',
    kind: 'gauge',
    unit: '{incident}',
    description: 'Alert incidents firing now, by severity.',
    attributes: { severity },
  },
];

/** How long one firing count is reused across collections. */
export const ALERTS_GAUGE_CACHE_TTL_MS = 30_000;

/**
 * Records the transition counter and observes the firing gauge. Never throws:
 * a metrics failure must not fail an evaluation.
 *
 * @stability experimental
 */
@Injectable()
export class AlertsMetrics implements OnModuleInit {
  private readonly logger = new Logger(AlertsMetrics.name);
  private readonly metrics: MetricsHostService;
  private registered = false;
  private cache: { at: number; value: Record<AlertSeverity, number> } | null = null;

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: AlertsPrisma,
    @Optional() metrics?: MetricsHostService,
  ) {
    this.metrics = metrics ?? new MetricsHostService();
  }

  /** Registers the firing gauge. */
  onModuleInit(): void {
    this.registerGauge();
  }

  /**
   * Counts one transition.
   *
   * @param to - `fired` or `resolved`.
   * @param level - the incident's severity.
   */
  transition(to: 'fired' | 'resolved', level: string): void {
    try {
      this.metrics.add('alertsTransitions' as never, 1, { to, severity: level });
    } catch (error) {
      this.logger.debug(`Could not count an alert transition: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** Registers the gauge once, only when gauges are on for this process. */
  registerGauge(): void {
    if (this.registered) return;
    try {
      const context = this.metrics.gaugeContext();
      if (!context) return;
      const gauge = createRegisteredGauge(context.meter, 'alertsFiring' as never);
      context.meter.addBatchObservableCallback((result) => this.observe(result, gauge, context), [gauge]);
      this.registered = true;
    } catch (error) {
      this.logger.debug(`Could not register the alerts gauge: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** The batch callback. Never throws. */
  async observe(result: BatchObservableResult, gauge: ObservableGauge, context: AppGaugeContext): Promise<void> {
    try {
      if (!context.gateOpen()) return;
      const counts = await this.counts(context.now());
      for (const level of ALERT_SEVERITIES) result.observe(gauge, counts[level], { severity: level });
    } catch (error) {
      this.logger.debug(`Alerts gauge callback skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private async counts(nowMs: number): Promise<Record<AlertSeverity, number>> {
    if (this.cache && nowMs - this.cache.at < ALERTS_GAUGE_CACHE_TTL_MS) return this.cache.value;
    const entries = await Promise.all(
      ALERT_SEVERITIES.map(async (level) => [level, await this.prisma.alertIncident.count({ where: { state: 'firing', severity: level } })] as const),
    );
    const value = Object.fromEntries(entries) as Record<AlertSeverity, number>;
    this.cache = { at: nowMs, value };
    return value;
  }
}
