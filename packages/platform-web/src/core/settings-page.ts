// The settings-page descriptor (issue #696, PP-2.7). A packaged admin or
// settings page exports one; the app turns it into a registry card and a route
// (Settings UI Pattern: the app stays the owner of its registries and routes).

import type { ComponentType } from 'react';
import type { SvgIcon } from '@mui/material';

/**
 * Descriptor a packaged admin/settings page exports; the app turns it into a
 * registry card (`{ ...page.card, Icon: page.Icon }`, appended to the right
 * section) and a route (`path={page.card.path}`, wrapped in the app's
 * permission gate for `page.card.permission`).
 *
 * @typeParam TFeature - the feature keys `card.feature` may take; `never` for a
 *   page that is never feature-gated, so the card is assignable to any app's
 *   card type.
 *
 * @example
 * ```tsx
 * // apps/web/src/config/adminSections.tsx
 * { ...doctorSettingsPage.card, Icon: doctorSettingsPage.Icon },
 * // apps/web/src/App.tsx
 * <Route path={doctorSettingsPage.card.path} element={
 *   <RequirePermission permission={doctorSettingsPage.card.permission!}><DoctorPage /></RequirePermission>
 * } />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export interface PlatformSettingsPage<TFeature extends string = string> {
  /** Stable id, e.g. `'doctor'`. */
  id: string;
  /** The registry card: the same text the page shows as its title and subtitle. */
  card: {
    /** Card and page title. */
    title: string;
    /** Card text and page subtitle. */
    description: string;
    /** The route, e.g. `/admin/settings/doctor`. */
    path: string;
    /** The exact permission the packaged API route enforces; absent means any signed-in user. */
    permission?: string;
    /** A deployment feature the card exists under (hidden while it is off). */
    feature?: TFeature;
  };
  /** Default icon (an MUI SvgIcon); the app may override it. */
  Icon: typeof SvgIcon;
  /** The route element; reads everything from `usePlatformHost()`. */
  Page: ComponentType;
}
