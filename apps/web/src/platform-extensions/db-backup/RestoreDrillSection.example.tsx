/**
 * Reference example (PP-14.12): an app's own section on the database backup
 * page, through `slots.Sections`.
 *
 * A backup nobody has restored is a hope. This section sits below the run
 * history and answers the one question the table does not: "when did we last
 * have a backup we could restore from, and is it long enough ago that we should
 * run a restore drill?" It reads only what the page already holds (the
 * runs on screen and whether the viewer may restore) and fetches nothing, so it
 * works against any app that renders the packaged page.
 *
 * `Sections` is rendered at both ends of the page (`position` is `'top'` or
 * `'bottom'`), so the panel returns `null` for the end it does not use.
 *
 * Wire it with
 * `<DbBackupPage slots={{ Sections: RestoreDrillSection }} />` where the route
 * renders the page (`App.tsx`). The reference app does not wire it: it ships
 * compiled and tested, like the other web examples.
 */
import { Alert, Box, Paper, Typography } from '@mui/material';
import type { ReactElement } from 'react';
import type { DbBackupSectionsProps } from '@marinoscar/platform-web/db-backup/ui';
import { NUMERIC_DATE, formatDate, useDisplayTimeZone } from '@marinoscar/platform-web/timezone/headless';

/** A drill is due when the newest restorable backup is older than this many days. */
export const RESTORE_DRILL_INTERVAL_DAYS = 90;

/**
 * The newest completed, verified, never-restored-from run among those given, or
 * `undefined`. A `stale` or `failed` run is not restorable, and a run that was
 * never read back (`verifiedAt` null) has not been proven to be an archive.
 */
function newestRestorable(runs: DbBackupSectionsProps['runs']): DbBackupSectionsProps['runs'][number] | undefined {
  return [...runs]
    .filter((run) => run.status === 'completed' && run.verifiedAt !== null)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

export function RestoreDrillSection({ runs, canRestore, position }: DbBackupSectionsProps): ReactElement | null {
  useDisplayTimeZone(); // The dates render in the user's display zone.
  // `Sections` is rendered at both ends of the page; this panel belongs below the history.
  if (position !== 'bottom') return null;
  const newest = newestRestorable(runs);
  // The newest restore that actually happened, from any run on screen.
  const lastRestoredAt = [...runs]
    .map((run) => run.restoredAt)
    .filter((at): at is string => at !== null)
    .sort()
    .pop();
  const drillDue =
    lastRestoredAt === undefined ||
    Date.now() - Date.parse(lastRestoredAt) > RESTORE_DRILL_INTERVAL_DAYS * 86_400_000;

  return (
    <Paper component="section" aria-label="Restore drill" sx={{ p: 2, mt: 2 }}>
      <Typography variant="h6" gutterBottom>
        Restore drill
      </Typography>
      <Box sx={{ mb: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {newest
            ? `Newest restorable backup: ${formatDate(newest.createdAt, NUMERIC_DATE)} (verified).`
            : 'No verified backup on this page to restore from.'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {lastRestoredAt
            ? `Last restore: ${formatDate(lastRestoredAt, NUMERIC_DATE)}.`
            : 'No restore has been performed from the backups on this page.'}
        </Typography>
      </Box>
      {drillDue && newest && (
        <Alert severity="info">
          Restore a copy to a scratch environment at least every {RESTORE_DRILL_INTERVAL_DAYS} days to prove
          the archive restores.
          {canRestore ? ' Use "Restore from this backup" on a row above.' : ' Ask an administrator who may restore.'}
        </Alert>
      )}
    </Paper>
  );
}
