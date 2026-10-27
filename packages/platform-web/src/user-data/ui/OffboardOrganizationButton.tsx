// The "Offboard" action of one organization row (issue #743): shown to an
// `orgs:offboard` holder, never for the default organization. The app hands
// it to the organizations page's `renderActions` slot.

import type { ReactElement } from 'react';
import { useState } from 'react';
import { Button } from '@mui/material';
import { ORG_OFFBOARD_PERMISSION, type OrgOffboardingResult } from '@marinoscar/platform-contract/user-data';

import { usePlatformViewer } from '../../core/index.js';
import { OrgOffboardingDialog, type OffboardedOrganization } from './OrgOffboardingDialog.js';

/**
 * An organization row, as the button reads it.
 *
 * @stability experimental
 */
export interface OffboardableOrganization extends OffboardedOrganization {
  /** Whether it is the default organization (never offboarded). */
  isDefault: boolean;
}

/**
 * Props of {@link OffboardOrganizationButton}.
 *
 * @stability experimental
 */
export interface OffboardOrganizationButtonProps {
  /** The organization of the row (`isDefault` hides the button). */
  organization: OffboardableOrganization;
  /** Called after the offboarding succeeds (refresh the list). */
  onCompleted?(result: OrgOffboardingResult | null): void;
}

/**
 * The button and its dialog. Renders nothing without `orgs:offboard` or for
 * the default organization.
 *
 * @param props - see {@link OffboardOrganizationButtonProps}.
 *
 * @stability experimental
 * @extensionPoint component
 * @example
 * ```tsx
 * <OrganizationsPage renderActions={(org) => <OffboardOrganizationButton organization={org} onCompleted={refresh} />} />
 * ```
 */
export function OffboardOrganizationButton(props: OffboardOrganizationButtonProps): ReactElement | null {
  const viewer = usePlatformViewer();
  const [open, setOpen] = useState(false);
  if (props.organization.isDefault || !viewer.hasPermission(ORG_OFFBOARD_PERMISSION)) return null;
  return (
    <>
      <Button size="small" variant="outlined" color="error" onClick={() => setOpen(true)}>
        Offboard
      </Button>
      <OrgOffboardingDialog organization={open ? props.organization : null} onClose={() => setOpen(false)} onCompleted={props.onCompleted} />
    </>
  );
}
