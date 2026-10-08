// =============================================================================
// The phone bottom bar (issue #868; moved from the reference app's
// `components/navigation/BottomNav.tsx`, issue #55)
// =============================================================================
//
// The ONLY navigation chrome below `sm`: no drawer, no hamburger. FOUR
// ACTIONS IS THE CEILING: five labelled tabs do not fit at 360px, so a fifth
// destination forces a choice between labels and the tab. Active state comes
// from the destination model, never a path prefix.
// =============================================================================

import { BottomNavigation, BottomNavigationAction, Paper, useMediaQuery, useTheme } from '@mui/material';
import type { ReactElement, SyntheticEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';

import { usePermissions } from '../../identity/index.js';
import { useSettingsFeatures } from '../../settings/index.js';
import { isDestinationVisible, resolveActiveDestination, shellDestinationRoutes } from '../headless/navigation.js';
import type { ShellNavigation } from '../headless/navigation.js';

/**
 * Props of {@link ShellBottomNav}.
 *
 * @stability experimental
 */
export interface ShellBottomNavProps {
  /** The app's navigation. */
  navigation: ShellNavigation;
}

/**
 * The bottom bar. Gate 2 of the five coupled breakpoint gates: it renders only
 * below `sm`, even when mounted.
 *
 * @param props - see {@link ShellBottomNavProps}.
 * @returns the bar, or `null` at `sm` and up.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function ShellBottomNav({ navigation }: ShellBottomNavProps): ReactElement | null {
  const theme = useTheme();
  // The EXACT complement of `ShellLayout`'s `showRail` (`up('sm')`), and it
  // must stay that way: any drift opens a band with two navigation surfaces or
  // none. See the coupled-gate list in `ShellLayout`.
  const isCompactWindow = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();
  const location = useLocation();
  const { hasPermission } = usePermissions();
  // Before the early return, per the rules of hooks.
  const features = useSettingsFeatures();

  if (!isCompactWindow) return null;

  const visibleDestinations = navigation.destinations.filter((destination) =>
    isDestinationVisible(destination, hasPermission, features),
  );

  const resolved = resolveActiveDestination(shellDestinationRoutes(navigation), location.pathname);
  // `false`, NOT `null`, is MUI's "nothing selected": the correct rendering on
  // routes no destination owns, and for a destination the viewer cannot see.
  const active: string | false =
    resolved !== null && visibleDestinations.some((d) => d.key === resolved) ? resolved : false;

  const handleChange = (_: SyntheticEvent, value: string) => {
    const destination = navigation.destinations.find((d) => d.key === value);
    if (destination) navigate(destination.path);
  };

  return (
    <Paper
      elevation={3}
      sx={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: theme.zIndex.appBar,
      }}
    >
      <BottomNavigation value={active} onChange={handleChange} showLabels>
        {visibleDestinations.map((destination) => (
          <BottomNavigationAction
            key={destination.key}
            value={destination.key}
            // The COMPACT label (a 4-up bar gives each tab ~90px); the full
            // label is the accessible name.
            label={destination.compactLabel}
            aria-label={destination.label}
            icon={<destination.Icon />}
          />
        ))}
      </BottomNavigation>
    </Paper>
  );
}
