/**
 * Reference example (PP-14.23): an app adds a column to the packaged Jobs page
 * through `slots.Columns`, with no package edit.
 *
 * "Waited" is how long a job sat in the queue before an executor started it
 * (`startedAt - createdAt`), the number an operator reads to decide whether the
 * workers keep up. It is derived from the row the page already holds, so the
 * column fetches nothing and the page's filters, paging and CSV export are
 * untouched (the column exports its value too).
 *
 * Wire it where the route renders the page (`App.tsx`):
 * `<JobsPage slots={{ Columns: withWaitedColumn }} />`. The reference app does
 * not wire it: it ships compiled and tested, like the other web examples.
 */
import type { Job, JobsTableColumn } from '@marinoscar/platform-web/jobs/headless';

/** Id of the added column (stable: the table persists column visibility under it). */
export const WAITED_COLUMN_ID = 'waited';

/** Whole seconds a job waited before it started, or `null` while it has not started. */
export function secondsWaited(job: Pick<Job, 'createdAt' | 'startedAt'>): number | null {
  if (!job.startedAt) return null;
  const waited = Date.parse(job.startedAt) - Date.parse(job.createdAt);
  return Number.isFinite(waited) && waited >= 0 ? Math.round(waited / 1000) : null;
}

const WAITED_COLUMN: JobsTableColumn<Job> = {
  id: WAITED_COLUMN_ID,
  label: 'Waited',
  priority: 'secondary',
  align: 'right',
  width: 110,
  value: (job) => {
    const seconds = secondsWaited(job);
    return seconds === null ? null : `${seconds} s`;
  },
};

/** `slots.Columns`: the page's columns with "Waited" placed after "Created", or last when that column is gone. */
export function withWaitedColumn(base: JobsTableColumn<Job>[]): JobsTableColumn<Job>[] {
  const at = base.findIndex((column) => column.id === 'createdAt');
  return at < 0 ? [...base, WAITED_COLUMN] : [...base.slice(0, at + 1), WAITED_COLUMN, ...base.slice(at + 1)];
}
