/**
 * Reference example (PP-14.24): an app adds its own section to the packaged
 * admin Android page through `slots.Sections`, and composes the page's exported
 * `NotificationsSection` into a page of its own, with no package edit.
 *
 * `StoreListingChecklist` is drawn under the three built-in sections
 * (`position === 'bottom'`). `NotificationsOnlyPage` shows the other half of
 * the story: an app that wants only the test-notification card on a page of its
 * own imports `NotificationsSection` from `android-app/ui`.
 *
 * Wire the slot where the route renders the page:
 * `<AndroidAppPage slots={{ Sections: StoreListingChecklist }} />`.
 */
import type { ReactElement } from 'react';
import { Container, List, ListItem, ListItemText, Paper, Typography } from '@mui/material';
import type { PageSectionsSlotProps } from '@marinoscar/platform-web/core';
import { NotificationsSection } from '@marinoscar/platform-web/android-app/ui';

const ITEMS = ['Screenshots for phone and tablet', 'Privacy policy URL', 'Data safety form answers'] as const;

export function StoreListingChecklist({ position }: PageSectionsSlotProps): ReactElement | null {
  if (position !== 'bottom') return null;
  return (
    <Paper variant="outlined" component="section" aria-labelledby="store-listing-title" sx={{ p: 2, mt: 3 }}>
      <Typography id="store-listing-title" variant="h6" component="h2">
        Store listing checklist
      </Typography>
      <List dense>
        {ITEMS.map((item) => (
          <ListItem key={item} disableGutters>
            <ListItemText primary={item} />
          </ListItem>
        ))}
      </List>
    </Paper>
  );
}

export function NotificationsOnlyPage({ canWrite }: { canWrite: boolean }): ReactElement {
  return (
    <Container maxWidth="md">
      <Typography variant="h4" component="h1" gutterBottom>
        Device notifications
      </Typography>
      <NotificationsSection canWrite={canWrite} />
    </Container>
  );
}
