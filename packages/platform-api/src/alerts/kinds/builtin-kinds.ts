import type { AlertRuleKind } from '../alerts.types';
import { alertRuleKindRegistry, registerAlertRuleKind } from './alert-kind.registry';
import { metricThresholdKind } from './metric-threshold.kind';
import { nodeEventKind } from './node-event.kind';
import { nodeOfflineKind } from './node-offline.kind';
import { telemetryUnavailableKind } from './telemetry-unavailable.kind';
import { verdictKind } from './verdict.kind';

/**
 * The five kinds the slice ships, in registration order.
 *
 * @stability experimental
 */
export const BUILTIN_ALERT_KINDS: readonly AlertRuleKind[] = [metricThresholdKind, nodeEventKind, verdictKind, nodeOfflineKind, telemetryUnavailableKind];

/**
 * Registers the built-in kinds. IDEMPOTENT: a kind already registered with the
 * built-in definition is skipped (`AlertsModule.forRoot` and an app may both
 * call it).
 *
 * @throws RegistryError `FROZEN` when something is left to register after the application bootstrapped.
 *
 * @stability experimental
 */
export function registerBuiltinAlertKinds(): void {
  for (const kind of BUILTIN_ALERT_KINDS) {
    if (alertRuleKindRegistry.get(kind.id) === kind) continue;
    registerAlertRuleKind(kind);
  }
}
