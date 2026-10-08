// =============================================================================
// The settings registries' card and section types and their helpers
// (issue #733; moved from the reference app's `config/adminSections.tsx`)
// =============================================================================
//
// ONE declaration, three consumers: the hub (`SettingsHub`), the Console rail
// and the AppBar title resolver all run THESE helpers over the app's own
// registry arrays (`ADMIN_SECTIONS`, `USER_SETTINGS_SECTIONS`, which stay in
// the app), so they cannot disagree about what exists and who may see it.
// =============================================================================

import type { SvgIconComponent } from '@mui/icons-material';

import { isFeatureEnabled, type SettingsFeatureKey, type SettingsFeatures } from '../headless/features.js';

/**
 * One settings page, fully described for every surface that draws it.
 *
 * `permission` is the API permission string the corresponding controller
 * ALREADY enforces: a registry never invents one, it mirrors it. A card with
 * no `permission` is visible to every signed-in user.
 *
 * @stability stable
 */
export interface SettingsCardDef {
  /** The card and page title. */
  title: string;
  /** The card's one or two sentences. */
  description: string;
  /** The icon COMPONENT; each consumer renders it at its own size. */
  Icon: SvgIconComponent;
  /** Route the card navigates to. Absent means "declared but not yet routed". */
  path?: string;
  /** Rendered, but inert: a page that exists in the IA but is not usable yet. */
  disabled?: boolean;
  /** API permission required to see the card at all; absent means "any signed-in user". */
  permission?: string;
  /**
   * Show the card even when `permission` is not held: for pages that gate
   * their own CONTENT and are still worth reaching.
   */
  alwaysShow?: boolean;
  /**
   * A deployment-wide FEATURE this card only exists under. Absent means
   * "always part of the IA". Applied before `alwaysShow`, and fail closed: an
   * omitted feature map hides the card.
   */
  feature?: SettingsFeatureKey;
}

/**
 * A titled group of cards: an `overline` header on the hub, a `ListSubheader`
 * in the rail.
 *
 * @stability stable
 */
export interface SettingsSectionDef {
  /** The group's label. */
  label: string;
  /** Its cards, in order. */
  cards: SettingsCardDef[];
}

/**
 * Filters `sections` to what `hasPermission` and `features` allow, optionally
 * also applying the hub's title search, and drops any section left empty (a
 * bare header above nothing reads as a loading failure).
 *
 * `query` matches the card TITLE only, case-insensitively.
 *
 * @param sections - the registry (passed whole; the gates live here).
 * @param hasPermission - the viewer's permission check.
 * @param query - the search text; empty matches everything.
 * @param features - the deployment feature map; omitted, every gated card is hidden.
 * @returns the visible sections.
 *
 * @stability stable
 */
export function visibleSettingsSections(
  sections: SettingsSectionDef[],
  hasPermission: (permission: string) => boolean,
  query = '',
  features: SettingsFeatures = {},
): SettingsSectionDef[] {
  const needle = query.trim().toLowerCase();
  return sections
    .map((section) => ({
      label: section.label,
      cards: section.cards.filter((card) => {
        if (!isFeatureEnabled(card.feature, features)) return false;
        if (needle && !card.title.toLowerCase().includes(needle)) return false;
        if (card.alwaysShow) return true;
        if (!card.permission) return true;
        return hasPermission(card.permission);
      }),
    }))
    .filter((section) => section.cards.length > 0);
}

/**
 * Resolves a pathname to the title of the settings page it renders (the
 * compact AppBar's drill-down title). LONGEST PREFIX WINS, on segment
 * boundaries. Returns `null` when the path is not under `hubPath` at all (not
 * a settings surface), and `hubTitle` for the hub itself or an unregistered
 * child. A card whose feature is off does not exist, so it titles nothing;
 * permission is deliberately not applied (a route the user reached is titled
 * whatever its gate said).
 *
 * @param sections - the registry.
 * @param hubPath - the hub's route (`/admin/settings`).
 * @param hubTitle - the hub's title.
 * @param pathname - the current path.
 * @param features - the deployment feature map.
 * @returns the title, or `null`.
 *
 * @stability stable
 */
export function settingsPageTitle(
  sections: SettingsSectionDef[],
  hubPath: string,
  hubTitle: string,
  pathname: string,
  features: SettingsFeatures = {},
): string | null {
  if (pathname !== hubPath && !pathname.startsWith(`${hubPath}/`)) return null;

  let best: { title: string; length: number } | null = null;
  for (const section of sections) {
    for (const card of section.cards) {
      if (!card.path) continue;
      if (!isFeatureEnabled(card.feature, features)) continue;
      const matches = pathname === card.path || pathname.startsWith(`${card.path}/`);
      if (matches && (!best || card.path.length > best.length)) {
        best = { title: card.title, length: card.path.length };
      }
    }
  }

  return best?.title ?? hubTitle;
}
