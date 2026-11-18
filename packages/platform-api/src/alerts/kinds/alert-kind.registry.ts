import type { z } from 'zod';

import { defineRegistry } from '../../core/index';
import { ALERT_KIND_PATTERN } from '@marinoscar/platform-contract/alerts';
import { AlertConfigError } from '../alerts.errors';
import type { AlertRuleKind } from '../alerts.types';

/**
 * Every registered rule kind. Open: an app adds its own with
 * {@link registerAlertRuleKind} at import time, before the application
 * bootstraps (the registry freezes then).
 *
 * @extensionPoint registry
 * @stability experimental
 */
export const alertRuleKindRegistry = defineRegistry<AlertRuleKind>({
  name: 'alert-rule-kinds',
  idOf: (kind) => kind.id,
  idPattern: ALERT_KIND_PATTERN,
  validate: (kind) => {
    if (typeof kind.evaluate !== 'function') throw new Error('an alert rule kind needs an evaluate function');
    if (!kind.configSchema || typeof (kind.configSchema as z.ZodType).safeParse !== 'function') {
      throw new Error('an alert rule kind needs a zod configSchema');
    }
  },
  describeDuplicate: (existing) =>
    `Duplicate alert rule kind "${existing.id}". Kind ids are persisted on rules; pick a new id.`,
});

/**
 * Registers a rule kind. Kind ids are PERMANENT once rules of the kind exist.
 *
 * @param kind - the kind.
 * @throws RegistryError `INVALID_ID`, `INVALID_ENTRY`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerAlertRuleKind<C>(kind: AlertRuleKind<C>): void {
  alertRuleKindRegistry.register(kind as AlertRuleKind);
}

/**
 * Validates `config` against the schema of `kind`, returning the parsed (and
 * defaulted) value.
 *
 * @param kind - the kind id.
 * @param config - the raw config.
 * @returns the parsed config.
 * @throws AlertConfigError `ALERT_UNKNOWN_KIND` or `ALERT_INVALID_CONFIG`.
 *
 * @stability experimental
 */
export function parseAlertConfig(kind: string, config: unknown): unknown {
  const def = alertRuleKindRegistry.get(kind);
  if (!def) throw new AlertConfigError('ALERT_UNKNOWN_KIND', `There is no alert rule kind "${kind}".`);
  const parsed = def.configSchema.safeParse(config ?? {});
  if (!parsed.success) {
    throw new AlertConfigError(
      'ALERT_INVALID_CONFIG',
      `The config does not match the "${kind}" kind.`,
      parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return parsed.data;
}
