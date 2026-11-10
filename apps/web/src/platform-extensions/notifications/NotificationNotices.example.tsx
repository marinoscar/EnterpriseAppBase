/**
 * Reference example (PP-14.24): an app puts notices of its own on the packaged
 * notification pages through `slots`, with no package edit.
 *
 * - `QuietHoursNotice`: `slots.BeforeContent` of the user preferences page.
 * - `ApprovalReminder`: `slots.BeforeContent` of the Broadcasts page, above the
 *   "New broadcast" button.
 * - `KeyRotationSection`: `slots.Sections` of the Web Push page, drawn after the
 *   page's own content.
 *
 * The channel columns and their labels are not a slot: they come from the
 * channel registry (`registerNotificationChannel` on the API) and from the
 * pages' `channelStates` prop, as the webhook example shows.
 *
 * Wire them where the routes render the pages (`App.tsx`):
 * `<UserNotificationsPage slots={{ BeforeContent: QuietHoursNotice }} />`.
 */
import type { ReactElement } from 'react';
import { Alert, Paper, Typography } from '@mui/material';
import type { PageSectionsSlotProps } from '@marinoscar/platform-web/core';

export function QuietHoursNotice(): ReactElement {
  return (
    <Alert severity="info" sx={{ mb: 2 }} data-testid="quiet-hours-notice">
      Quiet hours are 22:00 to 07:00. Nothing but security notices arrives then.
    </Alert>
  );
}

export function ApprovalReminder(): ReactElement {
  return (
    <Alert severity="warning" sx={{ mb: 2 }} data-testid="approval-reminder">
      A second administrator must approve every broadcast to all users before it is sent.
    </Alert>
  );
}

export function KeyRotationSection({ position }: PageSectionsSlotProps): ReactElement | null {
  if (position !== 'bottom') return null;
  return (
    <Paper variant="outlined" component="section" aria-labelledby="key-rotation-title" sx={{ p: 2, mt: 3 }}>
      <Typography id="key-rotation-title" variant="h6" component="h2">
        Key rotation policy
      </Typography>
      <Typography variant="body2" color="text.secondary">
        Rotate the key pair after any change of the push subject.
      </Typography>
    </Paper>
  );
}
