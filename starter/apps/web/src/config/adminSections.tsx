import { doctorSettingsPage } from '@marinoscar/platform-web/doctor/ui';
import { identityAdminSections } from '@marinoscar/platform-web/identity/ui';
import { jobsAdminSections } from '@marinoscar/platform-web/jobs/ui';
import type { SettingsSectionDef } from '@marinoscar/platform-web/settings/ui';

/**
 * The admin settings hub (`/admin/settings`), as data. Every card's
 * `permission` is the exact string the API route enforces. The packaged
 * slices ship their cards; the app decides where they go. APPEND new cards.
 */
export const ADMIN_SECTIONS: SettingsSectionDef[] = [
  { label: 'Access', cards: [...identityAdminSections.access, ...identityAdminSections.organizations] },
  {
    label: 'Operations',
    cards: [
      // The fleet page needs the nodes control plane, which the starter does not mount.
      ...jobsAdminSections.operations.filter((card) => card.path !== '/admin/settings/workers'),
      { ...doctorSettingsPage.card, Icon: doctorSettingsPage.Icon },
    ],
  },
];
