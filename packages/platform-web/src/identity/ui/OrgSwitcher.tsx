/**
 * The organization switcher (#726, PP-6.7), beside the AppBar's user menu.
 *
 * Renders NOTHING unless both hold:
 *   - the deployment is multi-org (`tenancyMode: 'multi'` from `/api/auth/me`;
 *     single-org mode hides org management entirely), and
 *   - the user has at least two ACTIVE memberships (one org is nothing to
 *     switch between).
 *
 * Choosing an organization calls `AuthContext.switchOrg`, which posts
 * `POST /api/auth/switch-org`, keeps the new access token and reloads the
 * user, so the permissions and every org-scoped page follow the new org. The
 * API decides whether the switch is allowed; a refusal leaves the session as
 * it was and is shown in the menu.
 *
 * An icon button with a menu, not a text select, so it costs one 48px touch
 * target in the toolbar at any width.
 */
import type { ReactElement } from 'react';
import { useState, type MouseEvent } from 'react';
import {
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from '@mui/material';
import { BusinessOutlined as BusinessIcon, Check as CheckIcon } from '@mui/icons-material';
import { useAuth } from '../headless/index.js';
import { useOrgsFeature } from '../headless/index.js';

/**
 * The organization switcher for the app bar: renders nothing unless the
 * deployment is multi-org and the user has at least two active memberships;
 * choosing one calls `useAuth().switchOrg`.
 *
 * @returns the component.
 *
 * @extensionPoint component
 * @stability stable
 */
export function OrgSwitcher(): ReactElement | null {
  const { activeOrg, memberships, switchOrg } = useAuth();
  const orgs = useOrgsFeature();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  if (!orgs || memberships.length < 2) return null;

  const label = activeOrg ? `Switch organization (current: ${activeOrg.name})` : 'Switch organization';

  async function choose(orgId: string) {
    if (orgId === activeOrg?.id) {
      setAnchorEl(null);
      return;
    }
    setSwitching(true);
    setError(null);
    try {
      await switchOrg(orgId);
      setAnchorEl(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not switch organization');
    } finally {
      setSwitching(false);
    }
  }

  return (
    <>
      <Tooltip title={label}>
        <IconButton
          color="inherit"
          aria-label={label}
          aria-haspopup="menu"
          aria-controls={anchorEl ? 'org-switcher-menu' : undefined}
          onClick={(event: MouseEvent<HTMLElement>) => setAnchorEl(event.currentTarget)}
          sx={{ mr: 1, flexShrink: 0 }}
        >
          <BusinessIcon />
        </IconButton>
      </Tooltip>
      <Menu
        id="org-switcher-menu"
        anchorEl={anchorEl}
        open={anchorEl !== null}
        onClose={() => setAnchorEl(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <Typography variant="overline" sx={{ px: 2, color: 'text.secondary' }}>
          Organizations
        </Typography>
        {memberships.map((membership) => {
          const current = membership.orgId === activeOrg?.id;
          return (
            <MenuItem
              key={membership.orgId}
              selected={current}
              disabled={switching}
              onClick={() => void choose(membership.orgId)}
            >
              <ListItemIcon>{current ? <CheckIcon fontSize="small" /> : null}</ListItemIcon>
              <ListItemText primary={membership.name} secondary={membership.slug} />
            </MenuItem>
          );
        })}
        {error && (
          <Typography role="alert" variant="body2" color="error" sx={{ px: 2, py: 1, maxWidth: 280 }}>
            {error}
          </Typography>
        )}
      </Menu>
    </>
  );
}
