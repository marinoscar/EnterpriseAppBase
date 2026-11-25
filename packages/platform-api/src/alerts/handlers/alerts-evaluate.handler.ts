import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { JobHandlerRegistry, type Job, type JobExecutionProfile, type JobHandler } from '../../jobs/index';
import { AlertsEvaluationService } from '../alerts-evaluation.service';
import { ALERTS_EVALUATE_TYPE } from '../alerts.constants';

/**
 * `alerts.evaluate`: evaluates every enabled rule. SERVER-ONLY (no
 * `nodeResultSchema`): it reads the telemetry store and the database and
 * dispatches notifications, none of which a remote node may do. A rule's
 * failure is recorded on the rule and never fails the job.
 *
 * @stability experimental
 */
@Injectable()
export class AlertsEvaluateHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(AlertsEvaluateHandler.name);
  readonly type = ALERTS_EVALUATE_TYPE;
  readonly label = 'Alert evaluation';
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 120_000, maxAttempts: 1 };

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly evaluation: AlertsEvaluationService,
  ) {}

  /** Registers the handler with the job registry. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /** Throws only when the rule list cannot be read (a database error). */
  async process(job: Job): Promise<void> {
    const outcomes = await this.evaluation.evaluateEnabled();
    const failed = outcomes.filter((o) => o.status === 'error').length;
    this.logger.log(`Evaluated ${outcomes.length} alert rule(s), ${failed} failed (job ${job.id})`);
  }
}
