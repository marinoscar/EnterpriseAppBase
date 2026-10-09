/**
 * The one user-data composition the app owns (issues #743, #880).
 *
 * `@marinoscar/platform-web/user-data/ui` ships the pages: the Danger Zone and
 * the factory reset mount directly (`App.tsx`), and re-read the signed-in user
 * themselves through the host's `viewer.refresh` (`platform/platformHost.tsx`).
 * What stays here is the join between two slices that do not know each other:
 * the identity slice's organizations page gets the user-data slice's "Offboard"
 * row action through its `renderActions` slot.
 */

import type { ReactElement } from 'react';
import { OrganizationsPage } from '@marinoscar/platform-web/identity/ui';
import { OffboardOrganizationButton } from '@marinoscar/platform-web/user-data/ui';

/** `/admin/settings/organizations` with the offboarding row action (`orgs:offboard`). */
export function OrganizationsRoute(): ReactElement {
  return (
    <OrganizationsPage
      renderActions={(organization, { refresh }) => <OffboardOrganizationButton organization={organization} onCompleted={refresh} />}
    />
  );
}
