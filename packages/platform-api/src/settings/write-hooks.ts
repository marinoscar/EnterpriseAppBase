// =============================================================================
// Settings write hooks (issues #1090, #1105)
// =============================================================================
//
// A namespace declaration may carry an `onWrite` hook: work that must commit
// or roll back WITH the settings write. The first user is dismiss-on-disable
// (turning a notification event off dismisses its live inbox rows); the seam is
// general, so a slice that must keep another table consistent with a settings
// change does the same.
//
// WHERE THE HOOK LIVES. On the namespace declaration (`UserSettingsNamespace`,
// `SystemSettingsNamespace`), not in a registry of its own: a hook belongs to
// the namespace whose change it reacts to, it is registered exactly when the
// namespace is, and "registration order" is the namespace registry's order.
// Extending a namespace (`extendUserSettingsNamespace`,
// `extendSystemSettingsNamespace`) keeps the base's hook.
//
// WHEN IT RUNS. Inside the transaction that writes the row, after the row is
// written and before commit, once per namespace whose value CHANGED (deep
// equality of the stored namespace before and after). A write that does not
// change a namespace never runs its hook, and a write with no hook to run is
// the plain, transaction-free write it always was.
//
// A hook that throws rolls the whole settings write back.
// =============================================================================

import { isDeepStrictEqual } from 'node:util';

import type { SettingsTx } from './data/settings-db';

/**
 * What a namespace's `onWrite` hook is told.
 *
 * @typeParam V - the namespace's value type.
 *
 * @stability experimental
 */
export interface SettingsWriteContext<V = unknown> {
  /**
   * The user whose settings were written (user scope), or the administrator
   * who made the write (system scope).
   */
  readonly userId: string;
  /** `'user'` for `user_settings`, `'system'` for the deployment-wide `system_settings`. */
  readonly scope: 'user' | 'system';
  /** The namespace's stored value before the write (`undefined` when absent). */
  readonly before: V | undefined;
  /** The namespace's stored value after the write (`undefined` when absent). */
  readonly after: V | undefined;
}

/**
 * A namespace's `onWrite` hook: runs inside the settings write's transaction,
 * after the row is written and before commit. Use `tx` for every statement;
 * anything done on another connection is not atomic with the write. A throw
 * rolls the write back.
 *
 * @typeParam V - the namespace's value type.
 *
 * @stability experimental
 */
export type SettingsWriteHook<V = unknown> = (tx: SettingsTx, context: SettingsWriteContext<V>) => Promise<void>;

/** The part of a namespace declaration the helper reads. */
interface HookedNamespace {
  readonly key: string;
  readonly onWrite?: SettingsWriteHook<never>;
}

/**
 * The hooks to run for a write: one per namespace that has an `onWrite` and
 * whose value differs between `before` and `after`, in the order given.
 *
 * @param namespaces - the namespaces, in registration order.
 * @param before - the settings document before the write.
 * @param after - the settings document after the write.
 * @param scope - which settings were written.
 * @param userId - the user (user scope) or the acting administrator (system scope).
 * @returns runnable steps; empty when no hooked namespace changed.
 *
 * @internal
 */
export function pendingWriteHooks(
  namespaces: readonly HookedNamespace[],
  before: unknown,
  after: unknown,
  scope: 'user' | 'system',
  userId: string,
): Array<(tx: SettingsTx) => Promise<void>> {
  const was = (before ?? {}) as Record<string, unknown>;
  const now = (after ?? {}) as Record<string, unknown>;
  const steps: Array<(tx: SettingsTx) => Promise<void>> = [];
  for (const ns of namespaces) {
    const hook = ns.onWrite as SettingsWriteHook | undefined;
    if (!hook || isDeepStrictEqual(was[ns.key], now[ns.key])) continue;
    steps.push((tx) => hook(tx, { userId, scope, before: was[ns.key], after: now[ns.key] }));
  }
  return steps;
}
