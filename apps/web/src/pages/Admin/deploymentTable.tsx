/**
 * The deploy-history table's column contract — issue #392, epic #388.
 *
 * Split out of `DeploymentPage.tsx` for the reason `workersTable.tsx` and
 * `dbBackupTable.tsx` are split out of their pages: the column definitions are
 * the part with a testable contract (what the scalar says, what the CSV
 * carries, which column names the row), and keeping them beside the page rather
 * than inside it means that contract can be asserted without mounting a
 * DataGrid.
 *
 * ⚠ NOTHING HERE IS SORTABLE OR FILTERABLE, and that is not an omission. The
 * history is a BOUNDED ARRAY EMBEDDED IN THE RESPONSE — `appctl` writes the
 * last N deploys into the state file — so there is no endpoint to send a sort
 * key or a filter operand to. `DataTableColumn.sortable` and `.filterable` both
 * document that they are server-side only, and a header that appears
 * interactive while nothing refetches is worse than a header with no
 * affordance at all (the rule the type's own comment states).
 *
 * The ORDER is newest first and is fixed by the page, not by a control here:
 * the API writes the array newest-first and the page reverses nothing. A
 * history somebody can re-order is a history two administrators comparing
 * screens can disagree about.
 */

import { Stack, Tooltip, Typography } from '@mui/material';
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutlineOutlined';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import type { DataTableColumn } from '../../components/datatable';
import {
  DEPLOYMENT_COMMAND_LABELS,
  deploymentCommitUrl,
  shortCommitSha,
} from '../../services/deployment';
import type { DeploymentHistoryEntry } from '../../services/deployment';
import { formatRelativeTime } from '../../utils/relativeTime';
// Imported from the sibling table module rather than re-implemented, the rule
// `workersTable.tsx` states: two duration formatters on two admin pages drift
// into one reading "1500 ms" beside another reading "1.5 s" for the same
// number, and an operator who just came from the queue page reads both.
import { formatDateTime, formatDuration } from './jobsTable';

/**
 * Persistence key for `user_settings.dataTables`. A constant, never derived
 * from the route or the heading: it is a storage key and must survive a rename.
 */
export const DEPLOYMENT_HISTORY_TABLE_ID = 'admin-deployment-history';

/**
 * A history entry with the stable identity `DataTable.rowId` requires.
 *
 * The API's entries carry no id — they are lines in a file, not rows in a table
 * — so one is synthesised from the two fields that together identify a deploy:
 * WHEN it ran and WHICH commit it landed. The index is appended as the final
 * tiebreak, because re-deploying the identical commit twice within the same
 * millisecond is not something this code gets to rule out.
 */
export interface DeploymentHistoryRow extends DeploymentHistoryEntry {
  id: string;
}

/** Give each entry the identity the table needs, preserving the API's order. */
export function toHistoryRows(
  history: DeploymentHistoryEntry[] | undefined,
): DeploymentHistoryRow[] {
  return (history ?? []).map((entry, index) => ({
    ...entry,
    id: `${entry.at}-${entry.commitSha}-${index}`,
  }));
}

/**
 * @param now the instant every relative timestamp is measured against — ONE
 *        clock for the whole render, so two deploys in the same minute cannot
 *        render as "1 minute ago" and "2 minutes ago".
 * @param repoUrl the record's repository URL, used ONLY through
 *        `deploymentCommitUrl`, which refuses anything that is not `https:`.
 *        Passing it in rather than reading it here keeps the one validation
 *        point in `services/deployment.ts`.
 */
export function buildDeploymentHistoryColumns(
  now: Date,
  repoUrl: string | null,
): DataTableColumn<DeploymentHistoryRow>[] {
  return [
    {
      /**
       * The row-unique `primary` column, and therefore the row's ACCESSIBLE
       * NAME — `rowAccessibleName()` takes the first visible `primary`
       * column's scalar and names every card after it. The scalar carries the
       * ABSOLUTE timestamp and not "3 hours ago": two rows deployed on
       * different days can both read "last week", and a card announced as
       * "last week" twice is two rows a screen-reader user cannot tell apart.
       *
       * `hideable: false` for the same reason: hiding this column would rename
       * every row after whichever column happened to be `primary` next.
       */
      id: 'at',
      label: 'When',
      priority: 'primary',
      hideable: false,
      minWidth: 200,
      flex: 1,
      value: (row) => formatDateTime(row.at),
      render: (row) => (
        <Stack sx={{ minWidth: 0 }}>
          <Typography variant="body2" noWrap>
            {formatRelativeTime(row.at, now)}
          </Typography>
          <Typography variant="caption" color="text.secondary" noWrap>
            {formatDateTime(row.at)}
          </Typography>
        </Stack>
      ),
    },
    {
      id: 'command',
      label: 'Command',
      priority: 'primary',
      width: 120,
      value: (row) => DEPLOYMENT_COMMAND_LABELS[row.command],
    },
    {
      id: 'ref',
      label: 'Ref',
      priority: 'primary',
      minWidth: 140,
      value: (row) => row.ref,
    },
    {
      /**
       * The short sha, linked to the forge ONLY when the repository URL
       * validates as `https:` — see `deploymentCommitUrl`. An `ssh://` or
       * `git@` remote renders as plain text, because it is not a web address
       * and a link built from one would either 404 or, for a hand-edited state
       * file, navigate somewhere chosen by whoever could write to that disk.
       *
       * The scalar is the short sha alone, so the CSV export carries the
       * identifier rather than a URL.
       */
      id: 'commitSha',
      label: 'Commit',
      priority: 'primary',
      minWidth: 140,
      value: (row) => shortCommitSha(row.commitSha),
      render: (row) => {
        const href = deploymentCommitUrl(repoUrl, row.commitSha);
        const label = shortCommitSha(row.commitSha);
        return (
          <Tooltip title={row.commitSha}>
            {href ? (
              <Link
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                sx={{ fontFamily: 'monospace' }}
              >
                {label}
              </Link>
            ) : (
              <Typography variant="body2" component="span" sx={{ fontFamily: 'monospace' }}>
                {label}
              </Typography>
            )}
          </Tooltip>
        );
      },
    },
    {
      id: 'durationMs',
      label: 'Duration',
      priority: 'secondary',
      width: 120,
      align: 'right',
      value: (row) => formatDuration(row.durationMs),
    },
    {
      /**
       * An icon AND a word, never a colour on its own: a failed deploy in the
       * history is the single row on this page worth spotting, and "the red
       * one" is not information for a reader who cannot see the difference.
       */
      id: 'outcome',
      label: 'Outcome',
      priority: 'primary',
      width: 140,
      value: (row) => (row.outcome === 'success' ? 'Succeeded' : 'Failed'),
      render: (row) =>
        row.outcome === 'success' ? (
          <Chip
            size="small"
            variant="outlined"
            color="success"
            icon={<CheckCircleOutlineIcon fontSize="small" />}
            label="Succeeded"
          />
        ) : (
          <Chip
            size="small"
            variant="filled"
            color="error"
            icon={<ErrorOutlineIcon fontSize="small" />}
            label="Failed"
          />
        ),
    },
    {
      /**
       * `detail` priority: it is the answer to "which `appctl` did this", which
       * matters when a deploy behaved differently from the one before it, and
       * nothing else. On the phone card it sits below the fold; on the grid it
       * is off by default and available from the column picker.
       */
      id: 'appctlVersion',
      label: 'appctl',
      priority: 'detail',
      width: 120,
      value: (row) => row.appctlVersion,
    },
    {
      /**
       * Also `detail`. The commit this deploy REPLACED is what an operator
       * needs to build a diff link by hand after a bad update, and it is absent
       * on a first install — an em dash rather than a blank, so "there was no
       * predecessor" is distinguishable from "this column did not render".
       */
      id: 'previousSha',
      label: 'Previous commit',
      priority: 'detail',
      minWidth: 140,
      value: (row) => (row.previousSha ? shortCommitSha(row.previousSha) : '—'),
    },
  ];
}
