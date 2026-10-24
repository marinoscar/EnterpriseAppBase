// =============================================================================
// The app shell (issue #868; moved from the reference app's
// `components/common/Layout.tsx`, issues #55, #90, #258, #365, #745, #746)
// =============================================================================
//
// Two navigation treatments, one per size class:
//
//   compact (< sm)  ->  the bottom bar only. No drawer, no hamburger, and so no
//                       drawer state to manage.
//   medium  (sm-lg) ->  a permanent collapsed rail (56px).
//   expanded (>= lg)->  the same rail, expanded to 220px.
//
// The chrome is chosen by MOUNTING, not by rendering-then-hiding: exactly one
// navigation surface exists in the tree at any width, so a resize across `sm`
// swaps it rather than briefly showing two.
// =============================================================================

import { Box, useMediaQuery, useTheme } from '@mui/material';
import type { ReactElement, ReactNode } from 'react';
import { Outlet } from 'react-router-dom';

import type { ShellNavigation } from '../headless/navigation.js';
import { ShellAppBar } from './ShellAppBar.js';
import { ShellBottomNav } from './ShellBottomNav.js';
import { ShellNavigationRail } from './ShellNavigationRail.js';

/**
 * Props of {@link ShellLayout}: the app's navigation and branding, and the
 * slots. Every slot has a default built from `navigation` and `brand`; an app
 * that replaces one keeps the breakpoint gates, which stay here.
 *
 * @stability experimental
 */
export interface ShellLayoutProps {
  /** The app's navigation. Required unless `appBar`, `rail` and `bottomNav` are all given. */
  navigation?: ShellNavigation;
  /** The brand for the default AppBar (the app's name or a logo). */
  brand?: ReactNode;
  /** The top bar. Default `<ShellAppBar navigation={navigation} brand={brand} />`. */
  appBar?: ReactNode;
  /** The rail, mounted at `sm` and up only. Default `<ShellNavigationRail navigation={navigation} />`. */
  rail?: ReactNode;
  /** The bottom bar, mounted below `sm` only. Default `<ShellBottomNav navigation={navigation} />`. */
  bottomNav?: ReactNode;
  /**
   * Above the page, inside `<main>`: shell-wide banners (maintenance, an app
   * update, notification permission). Each should render NOTHING on an
   * ordinary day, so a pixel baseline never sees it.
   */
  banners?: ReactNode;
  /** After the bottom bar: dialogs mounted once for the shell (a welcome dialog). */
  overlays?: ReactNode;
  /** The page. Default `<Outlet />` (the layout is a route element). */
  children?: ReactNode;
}

function required(navigation: ShellNavigation | undefined, slot: string): ShellNavigation {
  if (navigation === undefined) {
    throw new Error(`ShellLayout: pass \`navigation\`, or the \`${slot}\` slot (its default needs the navigation).`);
  }
  return navigation;
}

/**
 * The app shell: the AppBar, the rail OR the bottom bar, and `<main>`.
 *
 * @param props - see {@link ShellLayoutProps}.
 * @returns the shell.
 *
 * @example
 * ```tsx
 * <Route element={<ShellLayout navigation={APP_NAVIGATION} brand={APP_NAME} />}>
 *   <Route index element={<Home />} />
 * </Route>
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export function ShellLayout(props: ShellLayoutProps): ReactElement {
  const theme = useTheme();
  // 600px, NOT 900px. This is Material 3's compact/medium window-class
  // boundary (compact < 600dp, medium 600-840dp), and M3 is explicit that a
  // rail is the correct chrome from medium upward. Gating at MUI's `md`
  // (900px) would hand the PHONE treatment to every 600-899px device: tablets
  // in portrait, foldables unfolded, phones in landscape.
  //
  // ⚠️ FIVE GATES ARE COUPLED AND MUST MOVE TOGETHER. Moving the rail alone
  // renders two navigation surfaces, or none, in the gap:
  //   1. this `showRail`                     - the rail itself
  //   2. `ShellBottomNav`'s `down('sm')`     - the EXACT complement
  //   3. `<main>`'s `pb` below               - clears the fixed bottom bar, and
  //                                            so is only needed where it exists
  //   4. `SettingsHub`'s `isCompactWindow`   - drill-down list below it, card
  //      (`settings/ui/SettingsHub.tsx`)       grid at and above it
  //   5. `ShellAppBar`'s `isCompactWindow`   - back arrow + resolved page title
  //                                            on a settings route
  // (4) and (5) are coupled to EACH OTHER as tightly as (1)-(3) are: the hub is
  // the page body and the AppBar is the header directly above it. They are
  // tied to (1)-(3) as well, because "there is no rail here" is exactly what
  // makes the hub itself the navigation below `sm`.
  //
  // This comment is the invariant's only enforcement; there is deliberately no
  // shared constant, because a constant would let (3) drift while still
  // compiling (docs/specs/settings-ui.md, "Breakpoint gates"). If you change
  // one number here, change all five.
  const showRail = useMediaQuery(theme.breakpoints.up('sm'));

  const appBar = props.appBar ?? <ShellAppBar navigation={required(props.navigation, 'appBar')} brand={props.brand} />;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        // The shell is the ONLY owner of viewport height: pages must not nest
        // their own 100vh inside it. `100dvh` tracks mobile browser chrome;
        // `100vh` is the fallback.
        minHeight: '100vh',
        '@supports (min-height: 100dvh)': { minHeight: '100dvh' },
        backgroundColor: theme.palette.background.default,
      }}
    >
      {appBar}
      {/* `minWidth: 0` on the ROW as well as on `<main>`: a runaway intrinsic
          width propagates through every flex level that omits it. */}
      <Box sx={{ display: 'flex', flexGrow: 1, minWidth: 0 }}>
        {/* Focus order follows visual order: rail, then main. */}
        {showRail && (props.rail ?? <ShellNavigationRail navigation={required(props.navigation, 'rail')} />)}
        <Box
          component="main"
          sx={{
            flexGrow: 1,
            // Load-bearing: a flex item's `min-width` defaults to its
            // min-content width, so without this a wide table widens the
            // whole shell past the viewport.
            minWidth: 0,
            p: 3,
            // Clears the fixed bottom bar, which only exists below `sm`: the
            // same breakpoint the bottom bar gates on (gate 3).
            pb: { xs: 10, sm: 3 },
          }}
        >
          {props.banners}
          {props.children ?? <Outlet />}
        </Box>
      </Box>
      {/* Mounted only where it renders. The bottom bar also gates itself on
          `down('sm')`; `!showRail` is the exact complement of the rail's
          gate, so there is no width with two navs and none with zero. */}
      {!showRail && (props.bottomNav ?? <ShellBottomNav navigation={required(props.navigation, 'bottomNav')} />)}
      {props.overlays}
    </Box>
  );
}
