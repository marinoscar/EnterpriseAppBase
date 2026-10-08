/**
 * The navigation rail — this app's binding of the packaged
 * `ShellNavigationRail` (`@marinoscar/platform-web/shell/ui`, issue #868).
 *
 * The rail (collapsed 56px at `sm`–`lg`, expanded 220px at `lg` and up, the
 * pinned Console row at the foot (#105), Console mode on `/admin/*` listing
 * `ADMIN_SECTIONS` (#94), the desktop-only collapse toggle) lives in the
 * package; `config/shell.ts` supplies this app's destinations, the Console's
 * registry and the collapse preference (`hooks/useNavigationPrefs`).
 * `Layout` mounts it at `sm` and up only (breakpoint gate 1).
 */
import { ShellNavigationRail } from '@marinoscar/platform-web/shell/ui';

import { APP_NAVIGATION } from '../../config/shell';

export { RAIL_WIDTH_COLLAPSED, RAIL_WIDTH_EXPANDED } from '@marinoscar/platform-web/shell/ui';

export function NavigationRail() {
  return <ShellNavigationRail navigation={APP_NAVIGATION} />;
}

export default NavigationRail;
