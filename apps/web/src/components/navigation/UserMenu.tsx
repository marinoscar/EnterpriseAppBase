/**
 * The avatar button in the AppBar and the menu behind it — every authenticated
 * user's one guaranteed piece of chrome, whatever their role. This app's
 * binding of the packaged `ShellUserMenu` (`@marinoscar/platform-web/shell/ui`,
 * issue #868): the menu draws the destinations of `config/destinations.ts`
 * (Home dropped: the brand already routes there) and sign-out; this file adds
 * the "Getting started" item (#745) and the version line below.
 *
 * =============================================================================
 * THE VERSION LINE (issue #401, epic #397)
 * =============================================================================
 *
 * `/admin/settings/about` reports this deployment in full, and it is gated on
 * `system_settings:read` — seeded Admin-only. But the person who needs a
 * version string most often is the one who CANNOT open that page: a Viewer
 * writing a bug report, or anyone being asked "what version are you on?". So
 * the line lives here, in the one menu every role reaches.
 *
 * ⚠ IT IS `__APP_VERSION__`, BAKED INTO THIS BUNDLE AT BUILD TIME, AND IT MUST
 * NOT BECOME A FETCH. The full argument is in `build-config/app-version.ts`;
 * the short version is that this number describes the JAVASCRIPT THE BROWSER
 * IS RUNNING, not the API process. Those two differing is precisely the bug a
 * version line exists to expose — a stale cached bundle served against a
 * freshly deployed API — and a number fetched from `/api/admin/about` would be
 * rendered by the stale bundle as the NEW version, hiding exactly the mismatch
 * it was added to reveal. (It would also be unreachable for most users, since that endpoint is
 * Admin-only.)
 *
 * ⚠ IT IS INSIDE THE MENU, WHICH IS CLOSED BY DEFAULT, AND THAT PLACEMENT IS
 * LOAD-BEARING FOR `tests/visual`. A version string rendered into a region a
 * pixel baseline captures makes EVERY future version bump a baseline failure —
 * and epic #397's own #405 bumps it on every deploy. See the note in
 * `tests/visual/support/harness.ts`.
 */
import { Box, Typography } from '@mui/material';
import { GettingStartedMenuItem } from '@marinoscar/platform-web/onboarding/ui';
import { ShellUserMenu } from '@marinoscar/platform-web/shell/ui';

import { APP_NAVIGATION } from '../../config/shell';

export function UserMenu() {
  return (
    <ShellUserMenu
      navigation={APP_NAVIGATION}
      // Issue #745. "Getting started" clears the stored welcome and
      // dismissals, so the welcome dialog and the checklists return. Renders
      // nothing without the shell's onboarding provider.
      items={(close) => <GettingStartedMenuItem onDone={close} />}
      footer={
        // THE VERSION LINE — see this file's header.
        //
        // Deliberately NOT a `MenuItem`: it is not an action, so it must not
        // be focusable, must not highlight on hover and must not be announced
        // as a menu item a keyboard user can activate. A plain `Box` inside
        // the menu is a label, which is what it is.
        //
        // `onClick` is stopped because the menu closes on any click inside
        // it; selecting the string to copy it into a bug report would
        // otherwise dismiss the menu on mouse-down-drag-up.
        <Box sx={{ px: 2, py: 1 }} onClick={(event) => event.stopPropagation()} data-testid="user-menu-version">
          <Typography variant="caption" color="text.secondary">
            {`Version ${__APP_VERSION__}`}
          </Typography>
        </Box>
      }
    />
  );
}
