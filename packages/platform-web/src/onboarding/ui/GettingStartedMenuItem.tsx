import RocketLaunchOutlinedIcon from '@mui/icons-material/RocketLaunchOutlined';
import { ListItemIcon, ListItemText, MenuItem } from '@mui/material';
import type { ReactElement } from 'react';

import { useGettingStartedAction } from '../headless/getting-started.js';

/**
 * What {@link GettingStartedMenuItem} takes.
 *
 * @stability experimental
 */
export interface GettingStartedMenuItemProps {
  /** Called after the action ran (to close the menu, navigate). */
  onDone?: () => void;
}

/**
 * The "Getting started" item for the app's user menu: clears the stored
 * welcome and dismissals so the dialog and the checklists return. Renders
 * nothing without an onboarding provider or before its state loaded.
 *
 * @param props - see {@link GettingStartedMenuItemProps}.
 * @returns the menu item, or `null`.
 *
 * @example
 * ```tsx
 * <Menu ...><GettingStartedMenuItem onDone={handleClose} /></Menu>
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function GettingStartedMenuItem({ onDone }: GettingStartedMenuItemProps): ReactElement | null {
  const action = useGettingStartedAction();
  if (!action.visible) return null;
  return (
    <MenuItem
      onClick={() => {
        void action.run();
        onDone?.();
      }}
    >
      <ListItemIcon>
        <RocketLaunchOutlinedIcon fontSize="small" />
      </ListItemIcon>
      <ListItemText>{action.label}</ListItemText>
    </MenuItem>
  );
}
