/**
 * The top bar — this app's binding of the packaged `ShellAppBar`
 * (`@marinoscar/platform-web/shell/ui`, issue #868).
 *
 * The bar itself (both treatments, the compact drill-down of #95 with its
 * structural "up" arrow, and breakpoint gate 5) lives in the package; this
 * file fills its slots:
 *
 *   - `brand`: the app's name (`APP_NAME`), which routes home;
 *   - `actions`: the notification centre's bell (#127), in BOTH treatments,
 *     because it is the only way into the centre anywhere in the app. It
 *     renders nothing without a `NotificationProvider`;
 *   - `wideActions`: the organization switcher (#726), dropped in the
 *     drill-down for the theme toggle's reason (the treatment is sized for
 *     three icon buttons). It renders nothing unless the deployment is
 *     multi-org and the user has two or more memberships;
 *   - `userMenu`: `UserMenu`, the app's menu binding.
 *
 * Takes NO props (#55): the hamburger callback went away with the drawer.
 */
import { APP_NAME } from '@app/shared';
import { NotificationBell } from '@marinoscar/platform-web/notifications/ui';
import { OrgSwitcher } from '@marinoscar/platform-web/identity/ui';
import { ShellAppBar } from '@marinoscar/platform-web/shell/ui';

import { APP_NAVIGATION } from '../../config/shell';
import { UserMenu } from './UserMenu';

export function AppBar() {
  return (
    <ShellAppBar
      navigation={APP_NAVIGATION}
      brand={APP_NAME}
      actions={<NotificationBell />}
      wideActions={<OrgSwitcher />}
      userMenu={<UserMenu />}
    />
  );
}
