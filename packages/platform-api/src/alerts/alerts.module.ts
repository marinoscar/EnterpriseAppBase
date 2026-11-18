import { Module, type DynamicModule, type Provider, type Type } from '@nestjs/common';

import { NodeLifecycleService } from '../nodes/index';
import { AlertContextService } from './alerts-context.service';
import { AlertsAdminController } from './alerts-admin.controller';
import { AlertsDispatchService } from './alerts-dispatch.service';
import { AlertsEvaluationService } from './alerts-evaluation.service';
import { AlertsEventListener } from './alerts-event.listener';
import { AlertsIncidentsService } from './alerts-incidents.service';
import { AlertsRulesService } from './alerts-rules.service';
import { AlertsSeedService } from './alerts-seed.service';
import { ALERTS_OPTIONS } from './alerts.constants';
import { AlertsMetrics } from './alerts.metrics';
import { resolveAlertsModuleOptions, type AlertsModuleOptions } from './alerts.options';
import { AlertsEvaluateEventHandler } from './handlers/alerts-evaluate-event.handler';
import { AlertsEvaluateHandler } from './handlers/alerts-evaluate.handler';
import { AlertsIncidentsPurgeHandler } from './handlers/alerts-incidents-purge.handler';
import { registerBuiltinAlertKinds } from './kinds/builtin-kinds';
import { AlertsEvaluateTask } from './tasks/alerts-evaluate.task';
import { AlertsPurgeTask } from './tasks/alerts-purge.task';

/**
 * The alerts slice: rules over telemetry metrics, worker-node events and
 * fleet health; incidents with a pending/firing/resolved state machine;
 * notifications and optional webhooks on a transition; the admin routes under
 * `/api/admin/alerts`.
 *
 * @stability experimental
 */
@Module({})
export class AlertsModule {
  /**
   * The slice for one app. Requires the core `PlatformHostModule`
   * (`PLATFORM_PRISMA`), the global settings and notifications modules, the
   * jobs module (for `JobsService` and the handler registry), the composed
   * `alerts` fragment, and `registerAlertsEmailTemplates()` plus
   * `registerNotifications(ALERTS_NOTIFICATIONS)` in the app's notification
   * manifest. Pass the configured telemetry module in `imports` to enable the
   * metric and verdict kinds; without it they report the store unavailable.
   *
   * @param options - see {@link AlertsModuleOptions}.
   * @returns the dynamic module. It exports the rules, incidents and evaluation services.
   * @throws Error when an option is out of range.
   *
   * @example
   * ```ts
   * export const alertsModule = AlertsModule.forRoot({ imports: [TelemetryModule] });
   * ```
   *
   * @extensionPoint option
   * @stability experimental
   */
  static forRoot(options: AlertsModuleOptions = {}): DynamicModule {
    const resolved = resolveAlertsModuleOptions(options);
    registerBuiltinAlertKinds();
    const tasks: Type<unknown>[] = [
      ...(resolved.evaluateTask ? [AlertsEvaluateTask] : []),
      ...(resolved.purgeTask ? [AlertsPurgeTask] : []),
    ];
    const providers: Provider[] = [
      { provide: ALERTS_OPTIONS, useValue: resolved },
      NodeLifecycleService,
      AlertsMetrics,
      AlertContextService,
      AlertsDispatchService,
      AlertsEvaluationService,
      AlertsRulesService,
      AlertsIncidentsService,
      AlertsSeedService,
      AlertsEventListener,
      AlertsEvaluateHandler,
      AlertsEvaluateEventHandler,
      AlertsIncidentsPurgeHandler,
      ...tasks,
    ];
    return {
      module: AlertsModule,
      imports: [...resolved.imports],
      controllers: [AlertsAdminController],
      providers,
      exports: [ALERTS_OPTIONS, AlertsRulesService, AlertsIncidentsService, AlertsEvaluationService, AlertsMetrics],
    };
  }
}
