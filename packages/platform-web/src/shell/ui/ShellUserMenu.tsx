// =============================================================================
// The avatar button and the menu behind it (issue #868; moved from the
// reference app's `components/navigation/UserMenu.tsx`, issues #55, #401)
// =============================================================================
//
// Every signed-in user's one guaranteed piece of chrome. The destinations come
// from the navigation table (the home destination is dropped: the brand
// already goes there), then the app's `items`, then sign-out, then the app's
// `footer` (the reference app's version line: a label, not a menu item).
// =============================================================================

import { Avatar, Box, Divider, IconButton, ListItemIcon, ListItemText, Menu, MenuItem, Typography } from '@mui/material';
import { Logout as LogoutIcon } from '@mui/icons-material';
import { useState } from 'react';
import type { MouseEvent, ReactElement, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';

import { useAuth, usePermissions } from '../../identity/index.js';
import { useSettingsFeatures } from '../../settings/index.js';
import { isDestinationVisible } from '../headless/navigation.js';
import type { ShellNavigation } from '../headless/navigation.js';

/**
 * Props of {@link ShellUserMenu}.
 *
 * @stability experimental
 */
export interface ShellUserMenuProps {
  /** The app's navigation: its destinations (except home) are the menu's rows. */
  navigation: ShellNavigation;
  /**
   * Extra rows after the destinations (the onboarding slice's
   * `GettingStartedMenuItem`). Given `close`, to close the menu after acting.
   */
  items?: (close: () => void) => ReactNode;
  /**
   * Below sign-out and a divider, inside the menu (closed by default, so a
   * pixel baseline never captures it): a version line, a legal link. A label
   * should not be a `MenuItem` (not focusable, not announced as an action);
   * stop its click from bubbling if selecting its text must not close the menu.
   */
  footer?: ReactNode;
  /** The sign-out row's label. Default `'Logout'`. */
  logoutLabel?: string;
}

/**
 * The avatar button and the user menu. Renders nothing without a signed-in user.
 *
 * @param props - see {@link ShellUserMenuProps}.
 * @returns the button and menu, or `null`.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export function ShellUserMenu({ navigation, items, footer, logoutLabel = 'Logout' }: ShellUserMenuProps): ReactElement | null {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const { user, logout } = useAuth();
  const { hasPermission } = usePermissions();
  const features = useSettingsFeatures();
  const navigate = useNavigate();
  const homePath = navigation.homePath ?? '/';

  const open = Boolean(anchorEl);

  const handleOpen = (event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleNavigate = (path: string) => {
    navigate(path);
    handleClose();
  };

  const handleLogout = async () => {
    handleClose();
    await logout();
  };

  if (!user) return null;

  // Home is dropped: the brand in the AppBar already routes there.
  const menuDestinations = navigation.destinations.filter(
    (destination) => destination.path !== homePath && isDestinationVisible(destination, hasPermission, features),
  );

  const initials =
    user.displayName
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || user.email[0]!.toUpperCase();

  return (
    <>
      <IconButton
        onClick={handleOpen}
        size="small"
        aria-controls={open ? 'user-menu' : undefined}
        aria-haspopup="true"
        aria-expanded={open ? 'true' : undefined}
      >
        <Avatar
          src={user.profileImageUrl || undefined}
          alt={user.displayName || user.email}
          sx={{ width: 32, height: 32, fontSize: '0.875rem' }}
        >
          {initials}
        </Avatar>
      </IconButton>

      <Menu
        id="user-menu"
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        onClick={handleClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        slotProps={{
          paper: { sx: { minWidth: 200, mt: 1 } },
        }}
      >
        <Box sx={{ px: 2, py: 1.5 }}>
          <Typography variant="subtitle2" noWrap>
            {user.displayName || 'No name set'}
          </Typography>
          <Typography variant="body2" color="text.secondary" noWrap>
            {user.email}
          </Typography>
        </Box>

        <Divider />

        {menuDestinations.map((destination) => (
          <MenuItem key={destination.key} onClick={() => handleNavigate(destination.path)}>
            <ListItemIcon>
              <destination.Icon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{destination.label}</ListItemText>
          </MenuItem>
        ))}

        {items?.(handleClose)}

        <Divider />

        <MenuItem onClick={handleLogout}>
          <ListItemIcon>
            <LogoutIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>{logoutLabel}</ListItemText>
        </MenuItem>

        {footer !== undefined && footer !== null && <Divider />}
        {footer}
      </Menu>
    </>
  );
}
