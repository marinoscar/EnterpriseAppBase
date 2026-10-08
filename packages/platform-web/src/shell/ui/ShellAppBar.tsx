// =============================================================================
// The top bar (issue #868; moved from the reference app's
// `components/navigation/AppBar.tsx`, issues #55, #95, #127, #425, #726)
// =============================================================================
//
// Two treatments, chosen by window class AND route. Below `sm` on a settings
// route the brand is replaced by a back arrow and the resolved page title (the
// DRILL-DOWN); everywhere else the brand, the actions, the theme toggle and
// the user menu. The app fills the slots: `brand`, `actions` (both
// treatments: the notification bell), `wideActions` (dropped in the
// drill-down: an organization switcher) and `userMenu`.
// =============================================================================

import { AppBar as MuiAppBar, Box, IconButton, Toolbar, Typography, useMediaQuery, useTheme } from '@mui/material';
import { ArrowBack as ArrowBackIcon, Brightness4 as DarkModeIcon, Brightness7 as LightModeIcon } from '@mui/icons-material';
import type { ReactElement, ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { settingsPageTitle, useSettingsFeatures } from '../../settings/index.js';
import type { SettingsFeatures } from '../../settings/index.js';
import type { ShellNavigation, ShellSettingsSurface } from '../headless/navigation.js';
import { useOptionalShellTheme } from '../headless/theme.js';
import { ShellUserMenu } from './ShellUserMenu.js';

interface DrillDown {
  /** The resolved page title: a card's title, or the surface's hub title. */
  title: string;
  /** Where the back button goes. */
  upPath: string;
}

/**
 * Resolve a pathname to the compact bar's title and its UP destination, or
 * `null` when the path is on no settings surface.
 *
 * UP ONE LEVEL, NEVER `navigate(-1)`: history-relative back diverges the
 * moment the user arrived any other way (a deep link, a redirect, an OAuth
 * callback), and then "back" silently means "leave the app". The hub's own
 * parent is the home path.
 *
 * No permission gate (the route guard denies an unpermitted page; naming the
 * page the user is looking at leaks nothing), but the FEATURE gate applies: a
 * card whose feature is off does not exist in this deployment.
 */
export function resolveDrillDown(
  surfaces: readonly ShellSettingsSurface[],
  pathname: string,
  features: SettingsFeatures,
  homePath = '/',
): DrillDown | null {
  for (const surface of surfaces) {
    const title = settingsPageTitle(surface.sections, surface.hubPath, surface.hubTitle, pathname, features);
    // `null` means "not this surface", a different answer from the hub's own title.
    if (title === null) continue;
    return { title, upPath: pathname === surface.hubPath ? homePath : surface.hubPath };
  }
  return null;
}

/**
 * Props of {@link ShellAppBar}: the navigation and the slots.
 *
 * @stability experimental
 */
export interface ShellAppBarProps {
  /** The app's navigation (its settings surfaces drive the drill-down; its destinations the default user menu). */
  navigation: ShellNavigation;
  /** The brand: the app's name or a logo. Clicking it goes home. */
  brand: ReactNode;
  /**
   * Actions in BOTH treatments, before the theme toggle (the notification
   * bell: on a settings screen it is still the only way into the centre).
   */
  actions?: ReactNode;
  /**
   * Actions outside the drill-down only, after the theme toggle (an
   * organization switcher). The drill-down is sized for three icon buttons.
   */
  wideActions?: ReactNode;
  /** The user menu. Default `<ShellUserMenu navigation={navigation} />`. */
  userMenu?: ReactNode;
}

/**
 * The top bar. Gate 5 of the five coupled breakpoint gates.
 *
 * @param props - see {@link ShellAppBarProps}.
 * @returns the bar.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export function ShellAppBar({ navigation, brand, actions, wideActions, userMenu }: ShellAppBarProps): ReactElement {
  const theme = useTheme();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const shellTheme = useOptionalShellTheme();
  const homePath = navigation.homePath ?? '/';

  // 600px: `down('sm')`, byte-identical to `ShellBottomNav`'s and
  // `SettingsHub`'s gates and the exact complement of `ShellLayout`'s
  // `showRail` (`up('sm')`).
  //
  // ⚠️ FIVE COUPLED GATES: the list and the reasoning live in `ShellLayout`.
  // This is member (5), bound most tightly to member (4), `SettingsHub`'s
  // `isCompactWindow`: that hub is the page body directly under this header.
  // If the two disagree the user gets a back-arrow header above a card grid,
  // or a brand toolbar above a drill-down list with no way back up. Do not
  // change this number alone.
  const isCompactWindow = useMediaQuery(theme.breakpoints.down('sm'));

  // Resolved at every width: a pure lookup, and hoisting it keeps the two
  // treatments one render decision.
  const features = useSettingsFeatures();
  const drillDown = isCompactWindow ? resolveDrillDown(navigation.settingsSurfaces ?? [], pathname, features, homePath) : null;

  return (
    <MuiAppBar
      position="sticky"
      color="default"
      elevation={0}
      sx={{
        backgroundColor: theme.palette.background.paper,
      }}
    >
      <Toolbar>
        {drillDown ? (
          <>
            {/* `edge="start"` so the arrow's glyph lines up with the content below. */}
            <IconButton
              onClick={() => navigate(drillDown.upPath)}
              color="inherit"
              edge="start"
              aria-label="Back"
              sx={{ mr: 1, flexShrink: 0 }}
            >
              <ArrowBackIcon />
            </IconButton>
            {/* `noWrap` with `minWidth: 0`, both required to ellipsize in a
                flex row. Not clickable: the back arrow is the navigation here. */}
            <Typography variant="h6" component="div" noWrap sx={{ fontWeight: 600, minWidth: 0 }}>
              {drillDown.title}
            </Typography>
          </>
        ) : (
          <Typography
            variant="h6"
            component="div"
            sx={{
              cursor: 'pointer',
              fontWeight: 600,
              flexShrink: 0,
            }}
            onClick={() => navigate(homePath)}
          >
            {brand}
          </Typography>
        )}

        {/* The flexible spacer: the only growable item, so the trailing
            cluster sits right and the toolbar never pushes the shell sideways. */}
        <Box aria-hidden sx={{ flexGrow: 1, minWidth: 0 }} />

        {actions}

        {/* The theme toggle, dropped in the drill-down: the same setting lives
            on the Appearance page, two taps inside that very surface. Drawn
            only under a `ShellThemeProvider`. */}
        {!drillDown && shellTheme && (
          <IconButton
            onClick={shellTheme.toggleMode}
            color="inherit"
            aria-label="toggle theme"
            sx={{ mr: 1, flexShrink: 0 }}
          >
            {shellTheme.isDarkMode ? <LightModeIcon /> : <DarkModeIcon />}
          </IconButton>
        )}

        {!drillDown && wideActions}

        <Box sx={{ flexShrink: 0 }}>{userMenu ?? <ShellUserMenu navigation={navigation} />}</Box>
      </Toolbar>
    </MuiAppBar>
  );
}
