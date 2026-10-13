/**
 * Reference example (PP-14.24): an app extends the packaged Danger Zone and
 * factory reset pages with no package edit.
 *
 * - The lists the pages print come from the API: the example app registers a
 *   factory reset step and a kept model with a `summary`
 *   (`apps/api/src/examples/user-data/user-data.examples.ts`), and the summary
 *   routes return their lines after the platform's. No web code is involved.
 * - `RetentionNotice` is the page's `slots.AfterContent`: the app's own words
 *   about what it retains after a deletion.
 * - The pages' `copy` renames what the app calls things (`ERASURE_COPY`).
 *
 * Wire them where the routes render the pages (`App.tsx`):
 * `<UserDangerZonePage copy={ERASURE_COPY} slots={{ AfterContent: RetentionNotice }} />`.
 */
import type { ReactElement } from 'react';
import { Typography } from '@mui/material';
import type { UserDangerZonePageCopy } from '@marinoscar/platform-web/user-data/ui';

export const ERASURE_COPY: UserDangerZonePageCopy = {
  title: 'Erase my data',
  ownedHeading: 'What we hold about you',
  keptHeading: 'What we must keep',
};

export function RetentionNotice(): ReactElement {
  return (
    <Typography variant="body2" color="text.secondary" sx={{ mt: 3 }} data-testid="retention-notice">
      Invoices are kept for seven years, as the law requires.
    </Typography>
  );
}
