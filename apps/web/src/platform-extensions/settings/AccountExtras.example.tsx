/**
 * Reference example (PP-14.24): an app adds sections of its own to the packaged
 * Profile, Appearance and Organization settings pages through `slots.Sections`,
 * with no package edit.
 *
 * `TimezoneCard` sits under the profile card, `DensityCard` above the theme card
 * and `BillingContactCard` after the generated organization namespace cards.
 * Each returns its card only for the position it wants. The cards here only
 * display a value; a real app would save through its own route (the page
 * permission checks stay on the server).
 *
 * Wire them where the routes render the pages:
 * `<UserProfilePage slots={{ Sections: TimezoneCard }} />`.
 */
import type { ReactElement } from 'react';
import { Paper, Typography } from '@mui/material';
import type { PageSectionsSlotProps } from '@marinoscar/platform-web/core';

function Card({ id, title, children }: { id: string; title: string; children: string }): ReactElement {
  return (
    <Paper variant="outlined" component="section" aria-labelledby={id} sx={{ p: 2, mt: 3 }}>
      <Typography id={id} variant="h6" component="h2">
        {title}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {children}
      </Typography>
    </Paper>
  );
}

export function TimezoneCard({ position }: PageSectionsSlotProps): ReactElement | null {
  return position === 'bottom' ? <Card id="timezone-card" title="Time zone">Dates are shown in your browser’s time zone.</Card> : null;
}

export function DensityCard({ position }: PageSectionsSlotProps): ReactElement | null {
  return position === 'top' ? <Card id="density-card" title="Density">Comfortable</Card> : null;
}

export function BillingContactCard({ position }: PageSectionsSlotProps): ReactElement | null {
  return position === 'bottom' ? <Card id="billing-contact-card" title="Billing contact">billing@example.com</Card> : null;
}
