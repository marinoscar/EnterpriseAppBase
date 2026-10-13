/**
 * Reference example (PP-14.25): an app adds a section to the packaged share
 * dialog through `slots.Sections`, and a control to its action row through
 * `slots.Footer`, with no package edit.
 *
 * The section is a stacked section like the built-in ones (never a tab) with its
 * own heading, and the dialog hands it the record being shared, whether the
 * viewer may change sharing, and the `onChanged` the host gave the dialog. The
 * footer gets the record and `onClose`.
 *
 * Use it where the app renders the dialog:
 * `<ShareDialog ... slots={SHARE_EXPIRY_SLOTS} />`. The reference app does not
 * wire it: it ships compiled and tested, like the other web examples.
 */
import { Box, Button, Typography } from '@mui/material';
import type { ShareDialogFooterProps, ShareDialogSectionsProps, ShareDialogSlots } from '@marinoscar/platform-web/sharing/ui';

/** A policy reminder shown above "People and groups", for those who may change sharing. */
export function SharingPolicySection({ position, resource, canWrite }: ShareDialogSectionsProps) {
  if (position !== 'top') return null;
  return (
    <Box component="section" aria-labelledby="share-policy-heading">
      <Typography id="share-policy-heading" variant="subtitle1" component="h3" gutterBottom>
        Sharing policy
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {canWrite
          ? `Anyone you share this ${resource.type.replace(/_/g, ' ')} with can see it until you remove their access. Review access every quarter.`
          : 'Only an owner can change who this is shared with.'}
      </Typography>
    </Box>
  );
}

/** A footer control: leaves the dialog and opens the record's activity log. */
export function OpenAuditLog({ resource, onClose }: ShareDialogFooterProps) {
  return (
    <Button onClick={onClose} href={`/audit?resource=${encodeURIComponent(`${resource.type}:${resource.id}`)}`}>
      Open audit log
    </Button>
  );
}

/** The share dialog slots this example fills. Keep it a module constant. */
export const SHARE_EXPIRY_SLOTS: ShareDialogSlots = { Sections: SharingPolicySection, Footer: OpenAuditLog };
