/**
 * Reference example (PP-14.23): an app adds a per-row action to the packaged
 * Worker Nodes page through `slots.RowActions`, with no package edit.
 *
 * "Copy host" puts the node's hostname on the clipboard, for an operator who is
 * about to open a shell on the machine. The slot receives the row (data, never
 * an API client), so the action reads only what the fleet table already holds.
 * It is drawn in an extra "More actions" column; the page's own "View vitals"
 * and "Delete node" actions are untouched.
 *
 * Wire it where the route renders the page (`App.tsx`):
 * `<WorkersPage slots={{ RowActions: CopyHostnameAction }} />`. The reference
 * app does not wire it: it ships compiled and tested, like the other web
 * examples.
 */
import { useState } from 'react';
import type { ReactElement } from 'react';
import { Button } from '@mui/material';
import type { WorkerNode } from '@marinoscar/platform-web/nodes/headless';

export function CopyHostnameAction({ row }: { row: WorkerNode }): ReactElement {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      size="small"
      aria-label={`Copy host of ${row.name}`}
      onClick={() => {
        void navigator.clipboard.writeText(row.hostname).then(() => setCopied(true));
      }}
    >
      {copied ? 'Copied' : 'Copy host'}
    </Button>
  );
}
