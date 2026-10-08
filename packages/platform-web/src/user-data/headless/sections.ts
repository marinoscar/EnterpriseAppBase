// The Danger Zone groups of the settings registries (issue #743, PP-9.1).
//
// Both registries pin their `Danger Zone` group LAST: the one documented
// exception to append-only (docs/specs/settings-ui.md). A group added later is
// inserted before it. `dangerZoneLastViolations` is the web conformance check.

/**
 * The label of the Danger Zone group, in both registries.
 *
 * @stability experimental
 */
export const DANGER_ZONE_GROUP_LABEL = 'Danger Zone';

/**
 * The structural shape of a settings registry the check reads.
 *
 * @stability experimental
 */
export interface SettingsSectionsLike {
  /** The groups, in hub order. */
  readonly length: number;
  /** Each group's label and cards. */
  readonly [index: number]: { readonly label: string; readonly cards: readonly { readonly path?: string }[] };
}

/**
 * Why a registry breaks the Danger-Zone-last rule: no Danger Zone group, more
 * than one, not last, or missing the expected card path.
 *
 * @param sections - `ADMIN_SECTIONS` or `USER_SETTINGS_SECTIONS`.
 * @param expectedPath - the card the group must hold (`/settings/danger-zone`, `/admin/settings/factory-reset`).
 * @returns one message per problem; empty when the registry conforms.
 *
 * @stability experimental
 * @extensionPoint hook
 * @example
 * ```ts
 * expect(dangerZoneLastViolations(USER_SETTINGS_SECTIONS, '/settings/danger-zone')).toEqual([]);
 * ```
 */
export function dangerZoneLastViolations(sections: SettingsSectionsLike, expectedPath: string): string[] {
  const labels = Array.from({ length: sections.length }, (_, i) => sections[i]!.label);
  const indexes = labels.flatMap((label, i) => (label === DANGER_ZONE_GROUP_LABEL ? [i] : []));
  if (indexes.length === 0) return [`no "${DANGER_ZONE_GROUP_LABEL}" group`];
  const problems: string[] = [];
  if (indexes.length > 1) problems.push(`${indexes.length} "${DANGER_ZONE_GROUP_LABEL}" groups; there must be one`);
  if (indexes[indexes.length - 1] !== sections.length - 1) {
    problems.push(`"${DANGER_ZONE_GROUP_LABEL}" is not the last group (last is "${labels[labels.length - 1]}"); insert new groups before it`);
  }
  const group = sections[indexes[0]!]!;
  if (!group.cards.some((card) => card.path === expectedPath)) problems.push(`"${DANGER_ZONE_GROUP_LABEL}" has no card for ${expectedPath}`);
  return problems;
}
