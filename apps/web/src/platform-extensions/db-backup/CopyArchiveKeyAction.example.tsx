/**
 * Reference example (PP-14.23): an app adds a per-run action to the packaged
 * database backup page through `slots.RunRowActions`, with no package edit.
 *
 * "Copy key" puts a completed run's object-storage key on the clipboard, which
 * is what an operator pastes into the storage console or a `pg_restore`
 * runbook. The slot receives the run and the viewer's permissions (data, never
 * an API client). It is drawn in an extra "More actions" column; the page's own
 * download, cancel, delete, restore and rollback actions are untouched, and
 * their permission rules still decide what each viewer may do.
 *
 * Wire it where the route renders the page (`App.tsx`):
 * `<DbBackupPage slots={{ RunRowActions: CopyArchiveKeyAction }} />`. The
 * reference app does not wire it: it ships compiled and tested, like the other
 * web examples.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from '@mui/material';
import type { DbBackupRunActionsProps } from '@marinoscar/platform-web/db-backup/ui';

export function CopyArchiveKeyAction({ run }: DbBackupRunActionsProps): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="small"
      disabled={run.status !== 'completed' || !run.storageKey}
      onClick={() => {
        void navigator.clipboard.writeText(run.storageKey ?? '').then(() => setCopied(true));
      }}
    >
      {copied ? 'Copied' : 'Copy key'}
    </Button>
  );
}
