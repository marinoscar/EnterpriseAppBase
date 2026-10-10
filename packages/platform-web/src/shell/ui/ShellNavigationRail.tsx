// =============================================================================
// The navigation rail (issue #868; moved from the reference app's
// `components/navigation/NavigationRail.tsx`, issues #55, #94, #105)
// =============================================================================
//
// Tablet and desktop chrome for the app's destinations, always visible, so
// navigating costs zero taps.
//
//   medium  (sm-lg)  ->  collapsed, 56px, icon over a short caption
//   expanded (>= lg) ->  220px, labelled rows + a collapse toggle
//
// Pinned destinations (the Console) sit at the foot, below a divider. A
// desktop user may collapse the rail (the `navigation` user setting); the
// medium tier is ALWAYS collapsed, or a stale preference would spend a third
// of a 600px screen on chrome.
//
// CONSOLE MODE: on a route under `navigation.console.prefix`, the EXPANDED
// rail swaps its contents for the visible cards of the console's registry,
// with a permanent "back" row at the top. Collapsed, it stays the library
// rail: 56px cannot hold a dozen card titles.
// =============================================================================

import { useMemo } from 'react';
import type { ReactElement } from 'react';
import {
  Box,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Tooltip,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import ArrowBackIcon from '@mui/icons-material/ArrowBack';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { Link as RouterLink, useLocation } from 'react-router-dom';

import { usePermissions } from '../../identity/index.js';
import { useSettingsFeatures, visibleSettingsSections } from '../../settings/index.js';
import { isDestinationVisible, owns, resolveActiveDestination, shellDestinationRoutes } from '../headless/navigation.js';
import type { ShellIcon, ShellNavigation, ShellRailPreference } from '../headless/navigation.js';
import { useShellRailPreference } from '../headless/rail-preference.js';

/**
 * The collapsed rail's width in px (the medium tier, and a collapsed desktop rail).
 *
 * @stability experimental
 */
export const RAIL_WIDTH_COLLAPSED = 56;

/**
 * The expanded rail's width in px (desktop, at `lg` and up).
 *
 * @stability experimental
 */
export const RAIL_WIDTH_EXPANDED = 220;

/**
 * The sticky AppBar's height: the rail sticks below it and fills the rest of
 * the viewport, so its own list scrolls instead of the page.
 */
const APPBAR_HEIGHT = 64;

const DEFAULT_CONSOLE_BACK = { label: 'Back to library', path: '/' };

interface RailRowProps {
  to: string;
  Icon: ShellIcon;
  /** Shown when expanded. */
  label: string;
  /** Shown under the icon when collapsed; falls back to `label`. */
  compactLabel?: string;
  /** Always the full label, so a collapsed row is never announced by its abbreviation. */
  accessibleName: string;
  active: boolean;
  expanded: boolean;
}

function RailRow({ to, Icon, label, compactLabel, accessibleName, active, expanded }: RailRowProps) {
  const theme = useTheme();

  const button = (
    <ListItemButton
      component={RouterLink}
      to={to}
      selected={active}
      aria-current={active ? 'page' : undefined}
      aria-label={accessibleName}
      sx={{
        borderRadius: 1,
        mx: 0.5,
        minWidth: 0,
        // Collapsed: icon over caption, centred, with the side padding cut so
        // the 56px rail leaves a 48px target.
        ...(expanded
          ? { py: 0.75 }
          : {
              flexDirection: 'column',
              alignItems: 'center',
              gap: 0.25,
              mx: 0.25,
              px: 0.25,
              py: 0.75,
            }),
        '&.Mui-focusVisible': {
          outline: `2px solid ${theme.palette.primary.main}`,
          outlineOffset: -2,
        },
      }}
    >
      <ListItemIcon
        sx={{
          color: active ? theme.palette.primary.main : theme.palette.text.secondary,
          minWidth: expanded ? 40 : 'auto',
          justifyContent: 'center',
        }}
      >
        <Icon fontSize={expanded ? 'medium' : 'small'} />
      </ListItemIcon>

      {expanded ? (
        <ListItemText
          primary={label}
          slotProps={{ primary: { variant: 'body2', noWrap: true } }}
          sx={{ minWidth: 0, my: 0 }}
        />
      ) : (
        <Typography
          aria-hidden
          variant="caption"
          noWrap
          sx={{
            fontSize: '0.625rem',
            lineHeight: 1.2,
            maxWidth: '100%',
            color: active ? theme.palette.primary.main : theme.palette.text.secondary,
          }}
        >
          {compactLabel ?? label}
        </Typography>
      )}
    </ListItemButton>
  );

  return (
    <ListItem disablePadding sx={{ minWidth: 0 }}>
      {/* A tooltip only where the visible text is abbreviated, on top of the
          accessible name, never instead of it. */}
      {expanded ? button : <Tooltip title={label} placement="right">{button}</Tooltip>}
    </ListItem>
  );
}

/**
 * Props of {@link ShellNavigationRail}.
 *
 * @stability experimental
 */
export interface ShellNavigationRailProps {
  /** The app's navigation: destinations, ownership, the Console, the collapse preference. */
  navigation: ShellNavigation;
}

/**
 * The navigation rail. `ShellLayout` mounts it at `sm` and up only (gate 1).
 *
 * @param props - see {@link ShellNavigationRailProps}.
 * @returns the rail.
 *
 * @extensionPoint component
 * @stability experimental
 */
export function ShellNavigationRail({ navigation }: ShellNavigationRailProps): ReactElement {
  const theme = useTheme();
  const { pathname } = useLocation();
  const { hasPermission } = usePermissions();
  const useRailPreference: () => ShellRailPreference = navigation.useRailPreference ?? useShellRailPreference;
  const { railCollapsed, toggleRailCollapsed } = useRailPreference();

  // `lg`, not a settings-UI gate: this is the rail's own medium/expanded split.
  const isDesktop = useMediaQuery(theme.breakpoints.up('lg'));

  // The medium tier ignores the preference entirely (see the file header).
  const expanded = isDesktop && !railCollapsed;

  const consoleConfig = navigation.console;
  const isConsole = consoleConfig !== undefined && owns(consoleConfig.prefix, pathname);

  // Console mode needs the expanded rail; collapsed, the library rail shows.
  const consoleMode = isConsole && expanded;

  const activeDestination = resolveActiveDestination(shellDestinationRoutes(navigation), pathname);

  const features = useSettingsFeatures();
  const visibleDestinations = navigation.destinations.filter((destination) =>
    isDestinationVisible(destination, hasPermission, features),
  );

  // Pinned destinations leave the list for the foot; the rest keep order.
  const listDestinations = visibleDestinations.filter((destination) => !destination.pinned);
  const pinnedDestinations = visibleDestinations.filter((destination) => destination.pinned);

  // The same filter the hub applies (permission AND feature), so the rail
  // never lists a card the hub would hide. Empty query: no search here.
  const consoleSections = useMemo(
    () => (consoleMode && consoleConfig ? visibleSettingsSections(consoleConfig.sections, hasPermission, '', features) : []),
    [consoleMode, consoleConfig, hasPermission, features],
  );

  // The longest card path owning the pathname is the active row, so a nested
  // card (`/admin/settings/jobs/insights`) beats its parent.
  const consoleActivePath = useMemo(() => {
    if (!consoleMode) return null;
    return consoleSections
      .flatMap((section) => section.cards)
      .reduce<string | null>((best, card) => {
        if (!card.path || card.disabled) return best;
        if (!owns(card.path, pathname)) return best;
        return best === null || card.path.length > best.length ? card.path : best;
      }, null);
  }, [consoleMode, consoleSections, pathname]);

  const consoleBack = consoleConfig?.back ?? DEFAULT_CONSOLE_BACK;

  const subheaderSx = {
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase' as const,
    color: theme.palette.text.disabled,
    lineHeight: '2rem',
    backgroundColor: 'transparent',
  };

  return (
    <Box
      component="nav"
      aria-label={consoleMode ? 'Console navigation' : 'Main navigation'}
      sx={{
        width: expanded ? RAIL_WIDTH_EXPANDED : RAIL_WIDTH_COLLAPSED,
        flexShrink: 0,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: theme.palette.background.paper,
        borderRight: `1px solid ${theme.palette.divider}`,
        position: 'sticky',
        top: APPBAR_HEIGHT,
        alignSelf: 'flex-start',
        height: `calc(100vh - ${APPBAR_HEIGHT}px)`,
        '@supports (height: 100dvh)': {
          height: `calc(100dvh - ${APPBAR_HEIGHT}px)`,
        },
        overflowY: 'auto',
        overflowX: 'hidden',
        transition: theme.transitions.create('width', {
          duration: theme.transitions.duration.shorter,
        }),
        '@media (prefers-reduced-motion: reduce)': {
          transition: 'none',
        },
      }}
    >
      {consoleMode ? (
        <Box sx={{ flexGrow: 1, py: 1, minWidth: 0 }}>
          {/* Console is a MODE, so the way out is permanent and at the top. It
              replaces the pinned Console row at the foot (#105); never
              `active`: it is where you are going, not where you are. */}
          <List dense disablePadding>
            <RailRow
              to={consoleBack.path}
              Icon={ArrowBackIcon}
              label={consoleBack.label}
              accessibleName={consoleBack.label}
              active={false}
              expanded
            />
          </List>
          <Divider sx={{ my: 1 }} />

          {consoleSections.map((section) => (
            <List
              key={section.label}
              dense
              disablePadding
              subheader={
                <ListSubheader disableSticky sx={subheaderSx}>
                  {section.label}
                </ListSubheader>
              }
            >
              {section.cards.map((card) =>
                !card.path || card.disabled ? null : (
                  <RailRow
                    key={card.path}
                    to={card.path}
                    Icon={card.Icon}
                    label={card.title}
                    accessibleName={card.title}
                    active={card.path === consoleActivePath}
                    expanded
                  />
                ),
              )}
            </List>
          ))}
        </Box>
      ) : (
        <Box sx={{ flexGrow: 1, py: 1, minWidth: 0 }}>
          <List dense disablePadding>
            {listDestinations.map((destination) => (
              <RailRow
                key={destination.key}
                to={destination.path}
                Icon={destination.Icon}
                label={destination.label}
                compactLabel={destination.compactLabel}
                accessibleName={destination.label}
                active={activeDestination === destination.key}
                expanded={expanded}
              />
            ))}
          </List>
        </Box>
      )}

      {/* PINNED AT THE FOOT (#105), in both library treatments, never in
          Console mode (the back row is the affordance there). Already
          permission-filtered, so an empty list draws no divider. */}
      {!consoleMode && pinnedDestinations.length > 0 && (
        <>
          <Divider />
          <List dense disablePadding sx={{ py: 0.5 }}>
            {pinnedDestinations.map((destination) => (
              <RailRow
                key={destination.key}
                to={destination.path}
                Icon={destination.Icon}
                label={destination.label}
                compactLabel={destination.compactLabel}
                accessibleName={destination.label}
                active={activeDestination === destination.key}
                expanded={expanded}
              />
            ))}
          </List>
        </>
      )}

      {/* The collapse toggle is DESKTOP-ONLY (the medium tier is forced
          collapsed). A real <button> with `aria-expanded`. It stays in Console
          mode: collapsing is how a desktop user gets the library rail back. */}
      {isDesktop && (
        <>
          <Divider />
          <Box
            sx={{
              display: 'flex',
              justifyContent: expanded ? 'flex-end' : 'center',
              px: 0.5,
              py: 0.5,
            }}
          >
            <IconButton
              size="small"
              onClick={toggleRailCollapsed}
              aria-expanded={expanded}
              aria-label={expanded ? 'Collapse navigation' : 'Expand navigation'}
              sx={{
                '&.Mui-focusVisible': {
                  outline: `2px solid ${theme.palette.primary.main}`,
                  outlineOffset: -2,
                },
              }}
            >
              {expanded ? <ChevronLeftIcon fontSize="small" /> : <ChevronRightIcon fontSize="small" />}
            </IconButton>
          </Box>
        </>
      )}
    </Box>
  );
}
