/**
 * The user-data slice's pages, bound to this app (issue #743).
 *
 * `@marinoscar/platform-web/user-data/ui` ships the pages; this file only
 * hands them what the app owns: after a deletion or a factory reset succeeds,
 * the shell's cached user (display name, avatar) is re-read, and the
 * organizations page gets the "Offboard" row action through its
 * `renderActions` slot.
 */

import type { ReactElement } from 'react';
import { useAuth } from '@marinoscar/platform-web/identity/headless';
import { OrganizationsPage } from '@marinoscar/platform-web/identity/ui';
import { FactoryResetPage, OffboardOrganizationButton, UserDangerZonePage } from '@marinoscar/platform-web/user-data/ui';

/** `/settings/danger-zone`: the user's own deletion; refreshes the shell's user on success. */
export function DangerZoneRoute(): ReactElement {
  const { refreshUser } = useAuth();
  return <UserDangerZonePage onCompleted={() => void refreshUser()} />;
}

/** `/admin/settings/factory-reset`: Admin only; refreshes the shell's user on success. */
export function FactoryResetRoute(): ReactElement {
  const { refreshUser } = useAuth();
  return <FactoryResetPage onCompleted={() => void refreshUser()} />;
}

/** `/admin/settings/organizations` with the offboarding row action (`orgs:offboard`). */
export function OrganizationsRoute(): ReactElement {
  return (
    <OrganizationsPage
      renderActions={(organization, { refresh }) => <OffboardOrganizationButton organization={organization} onCompleted={refresh} />}
    />
  );
}
