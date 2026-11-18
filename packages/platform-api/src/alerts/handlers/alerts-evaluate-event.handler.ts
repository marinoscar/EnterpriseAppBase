import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { JobHandlerRegistry, type Job, type JobExecutionProfile, type JobHandler } from '../../jobs/index';
import { AlertsEvaluationService } from '../alerts-evaluation.service';
import { ALERTS_EVALUATE_EVENT_TYPE } from '../alerts.constants';
import type { AlertNodeEventPayload } from '../alerts.types';

function toPayload(raw: unknown): AlertNodeEventPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.nodeId !== 'string' || typeof p.type !== 'string') return null;
  return {
    nodeId: p.nodeId,
    nodeName: typeof p.nodeName === 'string' ? p.nodeName : p.nodeId,
    type: p.type,
    severity: typeof p.severity === 'string' ? p.severity : 'info',
    attrs: (p.attrs && typeof p.attrs === 'object' ? p.attrs : {}) as AlertNodeEventPayload['attrs'],
    occurredAt: typeof p.occurredAt === 'string' ? p.occurredAt : new Date().toISOString(),
  };
}

/**
 * `alerts.evaluate_event`: evaluates only the event-driven rules the reported
 * node event can change. SERVER-ONLY.
 *
 * @stability experimental
 */
@Injectable()
export class AlertsEvaluateEventHandler implements JobHandler, OnModuleInit {
  private readonly logger = new Logger(AlertsEvaluateEventHandler.name);
  readonly type = ALERTS_EVALUATE_EVENT_TYPE;
  readonly label = 'Alert evaluation (node event)';
  readonly profile: JobExecutionProfile = { maxRuntimeMs: 60_000, maxAttempts: 1 };

  constructor(
    private readonly registry: JobHandlerRegistry,
    private readonly evaluation: AlertsEvaluationService,
  ) {}

  /** Registers the handler with the job registry. */
  onModuleInit(): void {
    this.registry.register(this);
  }

  /** A payload that is not a node event is dropped (nothing to evaluate); a database error throws. */
  async process(job: Job): Promise<void> {
    const event = toPayload(job.payload);
    if (!event) {
      this.logger.warn(`Job ${job.id} carries no node event; nothing to evaluate`);
      return;
    }
    const outcomes = await this.evaluation.evaluateEnabled({ event });
    this.logger.log(`Evaluated ${outcomes.length} rule(s) for node event ${event.type} (job ${job.id})`);
  }
}
