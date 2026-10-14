// =============================================================================
// The phone bottom bar (issue #868; moved from the reference app's
// `components/navigation/BottomNav.tsx`, issue #55; PP-14.25 added `maxItems`)
// =============================================================================
//
// The ONLY navigation chrome below `sm`: no drawer, no hamburger. FOUR
// ACTIONS IS THE CEILING: five labelled tabs do not fit at 360px, so a fifth
// destination forces a choice between labels and the tab. Active state comes
// from the destination model, never a path prefix.
//
// PP-14.25: that ceiling is now the default of `maxItems` (4). With MORE
// visible destinations than `maxItems`, the bar draws the first `maxItems - 1`
// and a "More" action that opens a bottom sheet listing the rest, so a fifth
// destination no longer squeezes the labels. With `maxItems` or fewer the bar
// is exactly what it always was. The sheet lives inside this component, which
// renders below `sm` only, so it adds no breakpoint gate.
// =============================================================================

import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import {
  Badge,
  BottomNavigation,
  BottomNavigationAction,
  Box,
  Drawer,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  ListSubheader,
  Paper,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import type { BottomNavigationActionProps } from '@mui/material';
import { Fragment, useCallback, useEffect, useState } from 'react';
import type { MouseEvent, ReactElement } from 'react';
import { Link as RouterLink, useLocation, useNavigate } from 'react-router-dom';

import { usePermissions } from '../../identity/index.js';
import { useSettingsFeatures } from '../../settings/index.js';
import {
  groupDestinationRuns,
  isDestinationVisible,
  resolveActiveDestination,
  shellDestinationRoutes,
} from '../headless/navigation.js';
import type { ShellDestination, ShellNavigation } from '../headless/navigation.js';
import {
  DestinationIcon,
  EXTERNAL_LINK_PROPS,
  destinationAccessibleName,
  runDestinationClick,
  useDestinationBadge,
} from './destination-parts.js';

/** The value of the "More" action. Not a destination key (a key cannot contain a space). */
const MORE_VALUE = 'more destinations';

/** How many actions the bar draws by default, the "More" action included. */
const DEFAULT_MAX_ITEMS = 4;

/**
 * Props of {@link ShellBottomNav}.
 *
 * @stability experimental
 */
export interface ShellBottomNavProps {
  /** The app's navigation. */
  navigation: ShellNavigation;
  /**
   * The most actions the bar draws, the "More" action included. When more
   * destinations are visible than this, the bar draws the first `maxItems - 1`
   * and a "More" action that opens a sheet with the rest. At least 2.
   *
   * @defaultValue 4
   */
  maxItems?: number;
}

/**
 * One tab of the bar. `BottomNavigation` clones each child with `selected`,
 * `showLabel`, `value` and `onChange`; this forwards what the action needs and
 * handles the choice itself, so a destination's `onClick` can cancel the
 * navigation (the action's own `onChange` fires before its `onClick`).
 */
function BottomNavItem({
  destination,
  onNavigate,
  onChange,
  ...actionProps
}: { destination: ShellDestination; onNavigate: (destination: ShellDestination) => void } & BottomNavigationActionProps): ReactElement {
  void onChange;
  const badge = useDestinationBadge(destination);
  const external = destination.external === true;
  return (
    <BottomNavigationAction
      {...actionProps}
      {...(external ? { component: 'a', href: destination.path, ...EXTERNAL_LINK_PROPS } : {})}
      // The COMPACT label (a 4-up bar gives each tab ~90px); the full
      // label is the accessible name.
      label={destination.compactLabel}
      aria-label={destinationAccessibleName(destination.label, badge, external)}
      icon={<DestinationIcon Icon={destination.Icon} badge={badge} />}
      onClick={(event) => {
        if (runDestinationClick(destination, event)) return;
        if (!external) onNavigate(destination);
      }}
    />
  );
}

/** The "More" tab. Shows a dot when a destination in the sheet has a badge. */
function MoreItem({
  open,
  hasBadge,
  onOpen,
  onChange,
  ...actionProps
}: { open: boolean; hasBadge: boolean; onOpen: () => void } & BottomNavigationActionProps): ReactElement {
  void onChange;
  return (
    <BottomNavigationAction
      {...actionProps}
      label="More"
      aria-label={hasBadge ? 'More destinations (new activity)' : 'More destinations'}
      aria-haspopup="dialog"
      aria-expanded={open}
      icon={
        hasBadge ? (
          <Badge variant="dot" color="error" data-testid="destination-badge">
            <MoreHorizIcon />
          </Badge>
        ) : (
          <MoreHorizIcon />
        )
      }
      onClick={onOpen}
    />
  );
}

/** Reports whether one overflow destination has a badge, so the "More" tab can show a dot. Renders nothing. */
function OverflowBadgeProbe({
  destination,
  report,
}: {
  destination: ShellDestination;
  report: (key: string, present: boolean) => void;
}): null {
  const present = useDestinationBadge(destination) !== null;
  useEffect(() => {
    report(destination.key, present);
    return () => report(destination.key, false);
  }, [destination.key, present, report]);
  return null;
}

/** One row of the sheet. A component of its own so the destination's `badge` has a stable hook order. */
function SheetRow({
  destination,
  active,
  onChoose,
}: {
  destination: ShellDestination;
  active: boolean;
  onChoose: (destination: ShellDestination, event: MouseEvent<HTMLElement>) => void;
}): ReactElement {
  const badge = useDestinationBadge(destination);
  const external = destination.external === true;
  return (
    <ListItem disablePadding>
      <ListItemButton
        {...(external
          ? { component: 'a', href: destination.path, ...EXTERNAL_LINK_PROPS }
          : { component: RouterLink, to: destination.path })}
        selected={active}
        aria-current={active ? 'page' : undefined}
        aria-label={destinationAccessibleName(destination.label, badge, external)}
        onClick={(event: MouseEvent<HTMLElement>) => onChoose(destination, event)}
      >
        <ListItemIcon sx={{ minWidth: 40 }}>
          <DestinationIcon Icon={destination.Icon} badge={badge} />
        </ListItemIcon>
        <ListItemText primary={destination.label} />
        {external && <OpenInNewIcon aria-hidden fontSize="small" sx={{ color: 'text.secondary' }} />}
      </ListItemButton>
    </ListItem>
  );
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
export function ShellBottomNav({ navigation, maxItems = DEFAULT_MAX_ITEMS }: ShellBottomNavProps): ReactElement | null {
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
  const [sheetOpen, setSheetOpen] = useState(false);
  const [badged, setBadged] = useState<ReadonlySet<string>>(new Set());

  const reportBadge = useCallback((key: string, present: boolean) => {
    setBadged((previous) => {
      if (previous.has(key) === present) return previous;
      const next = new Set(previous);
      if (present) next.add(key);
      else next.delete(key);
      return next;
    });
  }, []);

  if (!isCompactWindow) return null;

  const visibleDestinations = navigation.destinations.filter((destination) =>
    isDestinationVisible(destination, hasPermission, features),
  );

  const limit = Number.isFinite(maxItems) ? Math.max(2, Math.floor(maxItems)) : DEFAULT_MAX_ITEMS;
  const overflows = visibleDestinations.length > limit;
  const barDestinations = overflows ? visibleDestinations.slice(0, limit - 1) : visibleDestinations;
  const sheetDestinations = overflows ? visibleDestinations.slice(limit - 1) : [];

  const resolved = resolveActiveDestination(shellDestinationRoutes(navigation), location.pathname);
  const activeInBar = resolved !== null && barDestinations.some((d) => d.key === resolved);
  const activeInSheet = resolved !== null && sheetDestinations.some((d) => d.key === resolved);
  // `false`, NOT `null`, is MUI's "nothing selected": the correct rendering on
  // routes no destination owns, and for a destination the viewer cannot see.
  const active: string | false = activeInBar && resolved !== null ? resolved : activeInSheet ? MORE_VALUE : false;

  const choose = (destination: ShellDestination, event: MouseEvent<HTMLElement>) => {
    setSheetOpen(false);
    // A router link navigates on its own; the click handler's veto is all that needs care.
    runDestinationClick(destination, event);
  };

  const sheetRuns = groupDestinationRuns(sheetDestinations);
  const probes = sheetDestinations.filter((destination) => destination.badge);

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
      {probes.map((destination) => (
        <OverflowBadgeProbe key={destination.key} destination={destination} report={reportBadge} />
      ))}
      <BottomNavigation value={active} showLabels>
        {barDestinations.map((destination) => (
          <BottomNavItem
            key={destination.key}
            value={destination.key}
            destination={destination}
            onNavigate={(next) => navigate(next.path)}
          />
        ))}
        {overflows && (
          <MoreItem
            key={MORE_VALUE}
            value={MORE_VALUE}
            open={sheetOpen}
            hasBadge={sheetDestinations.some((destination) => badged.has(destination.key))}
            onOpen={() => setSheetOpen(true)}
          />
        )}
      </BottomNavigation>

      {overflows && (
        <Drawer
          anchor="bottom"
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          slotProps={{
            paper: {
              'aria-label': 'More destinations',
              sx: { borderTopLeftRadius: 16, borderTopRightRadius: 16, maxHeight: '70vh', pb: 'env(safe-area-inset-bottom)' },
            },
          }}
        >
          <Box component="nav" aria-label="More destinations" sx={{ py: 1 }}>
            <Typography variant="subtitle2" component="h2" sx={{ px: 2, py: 1, color: 'text.secondary' }}>
              More
            </Typography>
            {sheetRuns.map((run, index) => (
              <Fragment key={`${index}:${run.group ?? ''}`}>
                <List
                  disablePadding
                  {...(run.group !== undefined
                    ? { subheader: <ListSubheader disableSticky>{run.group}</ListSubheader>, 'aria-label': run.group }
                    : {})}
                >
                  {run.destinations.map((destination) => (
                    <SheetRow key={destination.key} destination={destination} active={resolved === destination.key} onChoose={choose} />
                  ))}
                </List>
              </Fragment>
            ))}
          </Box>
        </Drawer>
      )}
    </Paper>
  );
}
