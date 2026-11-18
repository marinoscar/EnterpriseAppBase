// =============================================================================
// The event picker's model (issue #1046): pure functions over a subscription
// =============================================================================
//
// A subscription is the endpoint's `eventKeys`: exact keys
// (`jobs.job.failed`), group wildcards (`nodes.*`) and `*` (every event the
// owner may receive). The picker shows the catalog grouped by its `group`
// label; selecting a whole group writes the group's wildcard when one exists,
// so events added to the group later are delivered too.
//
// A group has a wildcard only when every key in it shares its first segment
// AND no key of another group starts with that segment: otherwise `x.*` would
// select events outside the group, and the group is selected key by key.
// Entries the catalog does not know (an event registered later, or one the
// caller can no longer subscribe to) are kept untouched.
// =============================================================================

import type { WebhookEventCatalogEntry } from '@marinoscar/platform-contract/webhooks';

/**
 * The subscription entry that means "every event".
 *
 * @stability experimental
 */
export const WEBHOOK_ALL_EVENTS = '*';

/**
 * One catalog group as the picker draws it.
 *
 * @stability experimental
 */
export interface WebhookEventGroup {
  /** The catalog's `group` label (`Nodes`). */
  group: string;
  /** Its events, in catalog order. */
  entries: WebhookEventCatalogEntry[];
  /** `<segment>.*` when the whole group is one prefix and no other group shares it, else `null`. */
  wildcard: string | null;
}

/**
 * Whether one subscription entry covers an event key.
 *
 * @param entry - `*`, `prefix.*` or an exact key.
 * @param key - the event key.
 * @returns `true` when a delivery of `key` would match.
 *
 * @stability experimental
 */
export function webhookEntryCovers(entry: string, key: string): boolean {
  if (entry === WEBHOOK_ALL_EVENTS) return true;
  if (entry.endsWith('.*')) return key.startsWith(entry.slice(0, -1));
  return entry === key;
}

/**
 * Groups the catalog by its `group` label, in first-seen order, and works
 * out each group's wildcard.
 *
 * @param entries - the catalog.
 * @returns the groups.
 *
 * @stability experimental
 */
export function groupWebhookEventCatalog(entries: readonly WebhookEventCatalogEntry[]): WebhookEventGroup[] {
  const order: string[] = [];
  const byGroup = new Map<string, WebhookEventCatalogEntry[]>();
  for (const entry of entries) {
    const list = byGroup.get(entry.group);
    if (list) list.push(entry);
    else {
      byGroup.set(entry.group, [entry]);
      order.push(entry.group);
    }
  }
  return order.map((group) => {
    const groupEntries = byGroup.get(group)!;
    const firsts = new Set(groupEntries.map((entry) => entry.key.split('.')[0]));
    let wildcard: string | null = null;
    if (firsts.size === 1) {
      const segment = [...firsts][0]!;
      const shared = entries.some((entry) => entry.group !== group && entry.key.split('.')[0] === segment);
      if (!shared) wildcard = `${segment}.*`;
    }
    return { group, entries: groupEntries, wildcard };
  });
}

/**
 * Whether the subscription delivers an event key.
 *
 * @param selection - the endpoint's `eventKeys`.
 * @param key - the event key.
 * @returns `true` when some entry covers it.
 *
 * @stability experimental
 */
export function isWebhookEventSelected(selection: readonly string[], key: string): boolean {
  return selection.some((entry) => webhookEntryCovers(entry, key));
}

/**
 * How much of a group the subscription covers.
 *
 * @param selection - the endpoint's `eventKeys`.
 * @param group - the group.
 * @returns `all`, `some` or `none`.
 *
 * @stability experimental
 */
export function webhookGroupSelectionState(selection: readonly string[], group: WebhookEventGroup): 'all' | 'some' | 'none' {
  const covered = group.entries.filter((entry) => isWebhookEventSelected(selection, entry.key)).length;
  if (covered === 0) return 'none';
  return covered === group.entries.length ? 'all' : 'some';
}

function dedupe(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Drops `keys` from the subscription: an exact entry is removed, and a
 * wildcard that covers one of them is replaced by what it covered of the
 * catalog minus `keys` (a whole other group by its own wildcard).
 */
function withoutKeys(selection: readonly string[], keys: ReadonlySet<string>, groups: readonly WebhookEventGroup[]): string[] {
  const next: string[] = [];
  for (const entry of selection) {
    const isPattern = entry === WEBHOOK_ALL_EVENTS || entry.endsWith('.*');
    if (!isPattern) {
      if (!keys.has(entry)) next.push(entry);
      continue;
    }
    if (![...keys].some((key) => webhookEntryCovers(entry, key))) {
      next.push(entry);
      continue;
    }
    for (const group of groups) {
      const coveredKeys = group.entries.map((e) => e.key).filter((key) => webhookEntryCovers(entry, key));
      if (coveredKeys.length === 0) continue;
      const untouched = coveredKeys.every((key) => !keys.has(key));
      if (untouched && coveredKeys.length === group.entries.length && group.wildcard) next.push(group.wildcard);
      else next.push(...coveredKeys.filter((key) => !keys.has(key)));
    }
  }
  return dedupe(next);
}

/**
 * Selects or deselects one event. Deselecting an event a wildcard covers
 * replaces the wildcard by the rest of what it covered.
 *
 * @param selection - the endpoint's `eventKeys`.
 * @param key - the event key.
 * @param groups - the grouped catalog.
 * @returns the new `eventKeys`.
 *
 * @stability experimental
 */
export function toggleWebhookEvent(selection: readonly string[], key: string, groups: readonly WebhookEventGroup[]): string[] {
  if (isWebhookEventSelected(selection, key)) return withoutKeys(selection, new Set([key]), groups);
  return dedupe([...selection, key]);
}

/**
 * Selects or deselects a whole group: with a wildcard the group is written as
 * `segment.*` (its exact keys are folded into it), else key by key.
 *
 * @param selection - the endpoint's `eventKeys`.
 * @param group - the group.
 * @param groups - the grouped catalog.
 * @returns the new `eventKeys`.
 *
 * @stability experimental
 */
export function toggleWebhookGroup(
  selection: readonly string[],
  group: WebhookEventGroup,
  groups: readonly WebhookEventGroup[],
): string[] {
  const keys = new Set(group.entries.map((entry) => entry.key));
  if (webhookGroupSelectionState(selection, group) === 'all') {
    return withoutKeys(
      selection.filter((entry) => entry !== group.wildcard),
      keys,
      groups,
    );
  }
  if (group.wildcard) {
    return dedupe([...selection.filter((entry) => !keys.has(entry)), group.wildcard]);
  }
  return dedupe([...selection, ...keys]);
}

/**
 * Switches "every event" (`*`) on (replacing every other entry) or off
 * (leaving an empty subscription to pick from).
 *
 * @param selection - the endpoint's `eventKeys`.
 * @returns the new `eventKeys`.
 *
 * @stability experimental
 */
export function toggleAllWebhookEvents(selection: readonly string[]): string[] {
  return selection.includes(WEBHOOK_ALL_EVENTS) ? [] : [WEBHOOK_ALL_EVENTS];
}

/**
 * The entries of a subscription the catalog does not account for: an exact
 * key it does not list, or a wildcard that covers none of its events. The
 * picker keeps them and lists them so the user can remove them.
 *
 * @param selection - the endpoint's `eventKeys`.
 * @param groups - the grouped catalog.
 * @returns those entries.
 *
 * @stability experimental
 */
export function unknownWebhookSubscriptions(selection: readonly string[], groups: readonly WebhookEventGroup[]): string[] {
  const keys = groups.flatMap((group) => group.entries.map((entry) => entry.key));
  return selection.filter((entry) => entry !== WEBHOOK_ALL_EVENTS && !keys.some((key) => webhookEntryCovers(entry, key)));
}

/**
 * Filters the grouped catalog by a search term (key, label or description,
 * case-insensitive); groups left with no match are dropped. A group whose
 * label matches keeps all its events.
 *
 * @param groups - the grouped catalog.
 * @param query - the search text.
 * @returns the matching groups (the same objects' entries filtered).
 *
 * @stability experimental
 */
export function searchWebhookEventGroups(groups: readonly WebhookEventGroup[], query: string): WebhookEventGroup[] {
  const term = query.trim().toLowerCase();
  if (term === '') return [...groups];
  const result: WebhookEventGroup[] = [];
  for (const group of groups) {
    if (group.group.toLowerCase().includes(term)) {
      result.push(group);
      continue;
    }
    const entries = group.entries.filter((entry) =>
      [entry.key, entry.label, entry.description].some((text) => text.toLowerCase().includes(term)),
    );
    if (entries.length > 0) result.push({ ...group, entries });
  }
  return result;
}
