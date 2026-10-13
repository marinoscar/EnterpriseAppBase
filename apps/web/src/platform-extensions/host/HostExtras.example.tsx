/**
 * Reference example (PP-14.24): an app extends the packaged host pages and
 * prompts through their slots and optional parts, with no package edit.
 *
 * - `OnCallNotice`: `slots.BeforeContent` of the admin Maintenance page, a
 *   reminder to announce before switching a window on.
 * - `SupportContacts`: `slots.Sections` of the About page (`position ===
 *   'bottom'`), the app's own contacts under the deployment facts.
 * - `StatusPageLink` / `SupportAction` / `AppMark`: the `children`, `actions`
 *   and `logo` of the public maintenance screen.
 * - `AppInstallMark`: the `icon` of the install offer, with the app's own
 *   `copy` (see the test).
 *
 * Wire them where the routes render the pages (`App.tsx`):
 * `<MaintenancePage slots={{ BeforeContent: OnCallNotice }} />`,
 * `<AboutPage slots={{ Sections: SupportContacts }} />`,
 * `<MaintenanceScreen logo={<AppMark />} actions={<SupportAction />}>...`.
 */
import type { ReactElement } from 'react';
import { Alert, Button, Paper, Typography } from '@mui/material';
import type { PageSectionsSlotProps } from '@marinoscar/platform-web/core';

export function OnCallNotice(): ReactElement {
  return (
    <Alert severity="info" sx={{ mb: 3 }} data-testid="on-call-notice">
      Announce in the operations channel before switching a window on.
    </Alert>
  );
}

export function SupportContacts({ position }: PageSectionsSlotProps): ReactElement | null {
  if (position !== 'bottom') return null;
  return (
    <Paper variant="outlined" component="section" aria-labelledby="support-contacts-title" sx={{ p: 2, mt: 3 }}>
      <Typography id="support-contacts-title" variant="h6" component="h2">
        Support contacts
      </Typography>
      <Typography variant="body2">operations@example.com</Typography>
    </Paper>
  );
}

export function StatusPageLink(): ReactElement {
  return (
    <Typography variant="body2" sx={{ textAlign: 'center' }}>
      Live status: status.example.com
    </Typography>
  );
}

export function SupportAction(): ReactElement {
  return (
    <Button size="small" href="mailto:support@example.com">
      Contact support
    </Button>
  );
}

export function AppMark(): ReactElement {
  return (
    <span role="img" aria-label="Example App logo" data-testid="app-mark">
      EA
    </span>
  );
}

export function AppInstallMark(): ReactElement {
  return (
    <span role="img" aria-label="Example App icon" data-testid="install-mark">
      EA
    </span>
  );
}
