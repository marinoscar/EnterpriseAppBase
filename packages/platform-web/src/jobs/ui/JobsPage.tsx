/**
 * Admin → Operations → Jobs (`/admin/settings/jobs`).
 *
 * Issue #266, epic #254; moved into `@marinoscar/platform-web/jobs` by #854
 * from the reference app's `pages/Admin/JobsPage.tsx`, same DOM and styles. A
 * REGISTRY CARD and nothing else, per `CLAUDE.md`'s MANDATORY Settings UI
 * Pattern: the app spreads `jobsAdminSections.operations` into its
 * `ADMIN_SECTIONS`, declares one route gated on the same permission string the
 * API enforces, and there is no tab anywhere. The hub, the Console rail and
 * the compact AppBar title all pick this page up from that single declaration.
 * The page reads permissions from the platform host's viewer, the app's table
 * and spinner from the jobs adapters, and takes the packaged-page slot contract
 * (`PageSlotsBase`, `TableSlots`, and `Filters`; PP-14.23).
 *
 * =============================================================================
 * THREE KINDS OF ACTION, AND THEY SIT IN THREE DIFFERENT PLACES
 * =============================================================================
 *
 * The queue offers actions at three different scopes, and putting any of them
 * in the wrong control would misstate what it does:
 *
 *   1. **Per row** — retry this job, delete this job. `DataTableRowAction`s, so
 *      they appear in the desktop grid's action cell, the tablet row expander
 *      and the phone card header from one declaration.
 *   2. **Queue-wide** — "Retry all failed", "Reset stuck". These are
 *      PAGE-LEVEL BUTTONS, next to the heading, and NOT bulk actions over a
 *      selection. `POST /retry-failed` sweeps every failed row in the queue
 *      (up to 500), whatever this page happens to be showing; offering it from
 *      a selection toolbar would tell the operator the selection scoped it,
 *      and they would find out otherwise only by reading the result count.
 *   3. **Nothing per selection** — which is why the table declares no
 *      `selection` at all. A checkbox column that gates no action is a column
 *      of dead controls, plus a tab stop per row for a keyboard user.
 *
 * =============================================================================
 * RETRY AND DELETE ARE NOT OFFERED FOR A `running` JOB
 * =============================================================================
 *
 * The API refuses both with a 400 (`job-admin.service.ts`), and the UI must not
 * offer what the API will refuse — so both actions carry
 * `disabled: (job) => !isJobActionable(job)`, sharing the predicate with the
 * service module rather than re-deriving `status !== 'running'` here.
 *
 * DISABLED, NOT ABSENT, per the rule `UserList` states: the set of actions must
 * not change shape row to row, or the operator has to hunt for a control that
 * moved. The disabled control keeps its tooltip, which is where the reason goes
 * — "an executor may still be working on it; use Reset stuck for a job whose
 * executor is gone".
 *
 * =============================================================================
 * POLLING, AND WHY IT STOPS WITH THE TAB
 * =============================================================================
 *
 * A queue changes with nobody touching it, so this is one of the few pages in
 * the app where a poll is the honest design — see `useVisiblePolling` in
 * the headless entry for why the interval is torn down while the tab is hidden
 * and why returning to it fetches immediately rather than waiting out a period.
 *
 * The poll REFRESHES rather than reloads: `useJobs.refresh` does not raise the
 * loading flag, so rows stay on screen and the table keeps its scroll offset,
 * its expansion and its focus. A spinner every ten seconds over data that is
 * already correct is the fastest way to make a live table unusable.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  Alert,
  Box,
  Button,
  Container,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Paper,
  Snackbar,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ReplayIcon from '@mui/icons-material/Replay';
import RestartAltIcon from '@mui/icons-material/RestartAlt';
import InsightsIcon from '@mui/icons-material/Insights';
import { Navigate, useNavigate } from 'react-router-dom';

import { usePlatformViewer, useTableSlotColumns } from '../../core/index.js';
import type { PageSlot, PageSlotsBase, TableSlots } from '../../core/index.js';
import {
  JOBS_POLL_INTERVAL_MS,
  isJobActionable,
  useJobActions,
  useJobStats,
  useJobs,
  useJobsApi,
  useVisiblePolling,
} from '../headless/index.js';
import type { Job, JobListParams, JobsTableColumn, JobsTableFilter, JobsTableRowAction } from '../headless/index.js';
import { JobsTable as DataTable } from './table.js';
import {
  PROCESSED_WITHIN_COLUMN_ID,
  SCHEDULED_COLUMN_ID,
  SCHEDULED_FILTER_VALUE,
  STATUS_COLUMN_ID,
  TABLE_ID,
  TYPE_COLUMN_ID,
  asJobStatus,
  asProcessedWithin,
  buildJobColumns,
  enforceExclusiveJobFilters,
  readIsFilter,
} from './jobsTable.js';
import { DefaultPageHeader } from './PageHeader.js';
import type { JobsPageHeaderProps } from './PageHeader.js';
import { JOBS_PAGE_DESCRIPTION as PAGE_DESCRIPTION, JOBS_PAGE_TITLE as PAGE_TITLE } from './copy.js';

type DataTableFilterModel = JobsTableFilter[];
type DataTableRowAction<Row> = JobsTableRowAction<Row>;

/**
 * The extra query parameters a `Filters` slot can set on the Jobs list, on top
 * of the table's own filters (status, type, backoff, activity window): the
 * organization and the subject a job is about.
 *
 * @stability experimental
 */
export type JobsExtraFilters = Pick<JobListParams, 'orgId' | 'subjectType' | 'subjectId'>;

/**
 * What the Jobs page passes its `Filters` slot.
 *
 * @stability experimental
 */
export interface JobsFiltersSlotProps {
  /** The extra parameters currently applied (empty to start with). */
  value: JobsExtraFilters;
  /** Replaces the extra parameters, returns to the first page and re-reads the list. Pass `{}` to clear. */
  onChange: (next: JobsExtraFilters) => void;
}

/**
 * The slots of {@link JobsPage}: the page-slot contract over a job row, and
 * `Filters`.
 *
 * `Header` keeps the props it always had (`title`, `description`, `readOnly`)
 * and gains `actions`, which is `null` because the queue-wide buttons stay in
 * the body. `Toolbar` is drawn in the row of queue-wide buttons, `Filters` in
 * its own row above the table, and `Columns` / `RowActions` / `DetailPanel` act
 * on the job table.
 *
 * @example
 * ```tsx
 * <JobsPage slots={{ Columns: (base) => [...base, ownerColumn], RowActions: ({ row }) => <OpenTicket job={row} /> }} />
 * ```
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface JobsPageSlots extends PageSlotsBase, TableSlots<Job, JobsTableColumn<Job>> {
  /** Replaces the title and subtitle block. */
  Header?: PageSlot<JobsPageHeaderProps>;
  /** Extra filter controls above the table (organization, subject). */
  Filters?: PageSlot<JobsFiltersSlotProps>;
}

/**
 * The props of {@link JobsPage}. Every prop is optional; the app's route
 * renders `<JobsPage />` as is.
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface JobsPageProps {
  /** Where the "Job insights" button goes. Default `'/admin/settings/jobs/insights'`. */
  insightsPath?: string;
  /** Where a viewer without `jobs:read` is sent. Default `'/'`. */
  fallbackPath?: string;
  /** Replaceable and additional parts of the page. */
  slots?: JobsPageSlots;
}

interface StatTileProps {
  label: string;
  value: number | string;
  /** Secondary line — the number's caveat, when it has one. */
  hint?: string;
  emphasis?: 'default' | 'warning' | 'error';
}

/**
 * One number and what it means.
 *
 * The label is rendered ABOVE the value and both are plain text, so the pair
 * reads as one string to a screen reader in DOM order ("Failed 12") without a
 * visually-hidden duplicate.
 */
function StatTile({ label, value, hint, emphasis = 'default' }: StatTileProps) {
  const color =
    emphasis === 'error' ? 'error.main' : emphasis === 'warning' ? 'warning.main' : 'text.primary';

  return (
    <Paper variant="outlined" sx={{ px: 2, py: 1.5, minWidth: 120, flexGrow: 1 }}>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 600, color }}>
        {value}
      </Typography>
      {hint && (
        <Typography variant="caption" color="text.secondary">
          {hint}
        </Typography>
      )}
    </Paper>
  );
}

/** Which queue-wide action a confirmation dialog is currently asking about. */
type PendingSweep = 'retry-failed' | 'reset-stuck' | null;

/**
 * Admin → Operations → Jobs: the queue summary, the queue-wide sweeps and the
 * paginated, filterable job list with per-row retry and delete. Gated on
 * `jobs:read` (the route's gate; this is the defence), writes on `jobs:write`.
 *
 * @param props - see {@link JobsPageProps}.
 * @returns the page.
 *
 * @example
 * ```tsx
 * <Route path="/admin/settings/jobs" element={
 *   <RequirePermission permission="jobs:read" fallback={<Navigate to="/" replace />}><JobsPage /></RequirePermission>
 * } />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function JobsPage(props: JobsPageProps = {}): ReactElement {
  const { insightsPath = '/admin/settings/jobs/insights', fallbackPath = '/', slots } = props;
  const Header = slots?.Header ?? DefaultPageHeader;
  const BeforeContent = slots?.BeforeContent;
  const Sections = slots?.Sections;
  const AfterContent = slots?.AfterContent;
  const Toolbar = slots?.Toolbar;
  const Filters = slots?.Filters;
  const { hasPermission } = usePlatformViewer();
  const navigate = useNavigate();
  const jobsApi = useJobsApi();

  const { jobs, total, isLoading, error, fetchJobs, refresh } = useJobs();
  const { stats, error: statsError, refresh: refreshStats } = useJobStats();

  const [page, setPage] = useState(0);
  const [pageSize, setPageSize] = useState(20);
  const [filters, setFilters] = useState<DataTableFilterModel>([]);
  const [pendingSweep, setPendingSweep] = useState<PendingSweep>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** What a `Filters` slot has set (empty unless the slot is used). */
  const [extraFilters, setExtraFilters] = useState<JobsExtraFilters>({});

  // --- Query params, flattened to SCALARS -------------------------------------
  // Never the `filters` array: `useJobs` hands back a new array on every change,
  // so an effect keyed on one would refetch forever.
  const status = asJobStatus(readIsFilter(filters, STATUS_COLUMN_ID));
  const type = readIsFilter(filters, TYPE_COLUMN_ID);
  const processedWithin = asProcessedWithin(readIsFilter(filters, PROCESSED_WITHIN_COLUMN_ID));
  const scheduled = readIsFilter(filters, SCHEDULED_COLUMN_ID) === SCHEDULED_FILTER_VALUE;
  const { orgId: extraOrgId, subjectType: extraSubjectType, subjectId: extraSubjectId } = extraFilters;

  /**
   * The query this page is currently showing, as the API takes it.
   *
   * `scheduled` and `status` are never both sent — `enforceExclusiveJobFilters`
   * keeps the model to one of them — so the request always matches the chips
   * above the table. See that function for why the server's own override is
   * not enough.
   */
  const query = useMemo<JobListParams>(
    () => ({
      page: page + 1, // the table is zero-based, the API is one-based
      pageSize,
      ...(scheduled ? { scheduled: true } : status ? { status } : {}),
      ...(type ? { type } : {}),
      ...(processedWithin ? { processedWithin } : {}),
      ...(extraOrgId ? { orgId: extraOrgId } : {}),
      ...(extraSubjectType ? { subjectType: extraSubjectType } : {}),
      ...(extraSubjectId ? { subjectId: extraSubjectId } : {}),
    }),
    [page, pageSize, scheduled, status, type, processedWithin, extraOrgId, extraSubjectType, extraSubjectId],
  );

  useEffect(() => {
    void fetchJobs(query);
  }, [fetchJobs, query]);

  /**
   * Re-read BOTH the rows and the summary.
   *
   * One function, so the strip and the table are never a poll apart: an
   * operator watching "Failed: 3" above a table with no failed rows in it has
   * no way to know which of the two is stale.
   */
  const refreshAll = useCallback(() => {
    void refresh();
    void refreshStats();
  }, [refresh, refreshStats]);

  const actions = useJobActions(refreshAll);
  useVisiblePolling(refreshAll, JOBS_POLL_INTERVAL_MS);

  // --- The filter columns need the deployment's real job types ----------------
  // Taken from `stats.byType` rather than hardcoded: the handler registry is a
  // server-side concern, and a fixed list here would offer filters for types
  // that have never run and omit the ones that have.
  const typeOptions = useMemo(
    () => (stats?.byType ?? []).map((entry) => ({ value: entry.type, label: entry.label })),
    [stats],
  );
  const baseColumns = useMemo(() => buildJobColumns(typeOptions), [typeOptions]);
  const columns = useTableSlotColumns<Job, JobsTableColumn<Job>>(baseColumns, slots);

  const canWrite = hasPermission('jobs:write');

  const rowActions = useMemo(() => {
    // The ARRAY is gated, never a rendered control: a reader without
    // `jobs:write` gets an array that does not CONTAIN these, so they are
    // absent from the grid, the tablet expander and the phone card at once.
    if (!canWrite) return [] as DataTableRowAction<Job>[];

    return [
      {
        id: 'retry',
        label: 'Retry job',
        icon: <ReplayIcon fontSize="small" />,
        // Mirrors the API's own refusal — see the file header.
        disabled: (job) => !isJobActionable(job),
        onClick: (job) => {
          void actions.retry(job.id).then((ok) => {
            if (ok) setNotice('Job queued for another attempt');
          });
        },
      },
      {
        id: 'delete',
        label: 'Delete job',
        icon: <DeleteIcon fontSize="small" />,
        destructive: true,
        disabled: (job) => !isJobActionable(job),
        confirm: {
          title: 'Delete this job?',
          description: (job) =>
            `${job.typeLabel} will be removed from the queue. This cannot be undone.`,
          confirmLabel: 'Delete',
        },
        onClick: (job) => {
          void actions.remove(job.id).then((ok) => {
            if (ok) setNotice('Job deleted');
          });
        },
      },
    ] satisfies DataTableRowAction<Job>[];
  }, [canWrite, actions]);

  const emptyState = useMemo(
    () => (
      <Typography color="text.secondary">
        {filters.length > 0
          ? 'No jobs match these filters'
          : 'No jobs have been enqueued yet'}
      </Typography>
    ),
    [filters.length],
  );

  // Defence, not the gate — `App.tsx` wraps the route in `RequirePermission`
  // with this same string, exactly as every sibling admin page does. It sits
  // after every hook so the hook order never changes.
  if (!hasPermission('jobs:read')) {
    return <Navigate to={fallbackPath} replace />;
  }

  const failedCount = stats?.byStatus.failed ?? 0;
  const stuckCount = stats?.stuckRunning ?? 0;

  const runSweep = async () => {
    if (pendingSweep === 'retry-failed') {
      setPendingSweep(null);
      const result = await actions.retryAllFailed();
      if (result) {
        setNotice(
          `Retried ${result.retried} job(s); skipped ${result.skipped} already queued; ` +
            `${result.remaining} still failed.`,
        );
      }
      return;
    }

    if (pendingSweep === 'reset-stuck') {
      setPendingSweep(null);
      // No `olderThanMinutes`: the API falls through to the
      // `jobs.stuckThresholdMinutes` setting, which is the same threshold
      // `stats.stuckRunning` was counted against — so the button can never
      // sweep a different set of rows than the number above it promised.
      const result = await actions.resetStuck();
      if (result) {
        setNotice(
          `Requeued ${result.reset} job(s) and failed ${result.failed} that were out of ` +
            `attempts, using a ${result.thresholdMinutes}-minute threshold.`,
        );
      }
    }
  };

  return (
    <Container maxWidth="xl">
      <Box sx={{ py: 4 }}>
        {/* Title and description MIRROR the registry card so the hub card, the
            rail row, the compact AppBar title and this `h1` all name the page
            identically. "(read-only)" is stated up front rather than left for
            the operator to discover by finding every control missing. */}
        <Header title={PAGE_TITLE} description={PAGE_DESCRIPTION} readOnly={!canWrite} actions={null} />
        {BeforeContent && <BeforeContent />}
        {Sections && <Sections position="top" />}

        {statsError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            {statsError}
          </Alert>
        )}
        {actions.error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={actions.clearError}>
            {actions.error}
          </Alert>
        )}

        {/* ------------------------------------------------------------------
            THE SUMMARY STRIP — the whole queue, not the page of rows below it,
            which is why it is on its own request and does not take the filters.
            ------------------------------------------------------------- */}
        <Stack
          direction="row"
          spacing={2}
          useFlexGap
          sx={{ flexWrap: 'wrap', mb: 3 }}
          aria-label="Queue summary"
        >
          <StatTile label="Total" value={stats?.total ?? 0} />
          <StatTile label="Pending" value={stats?.byStatus.pending ?? 0} />
          <StatTile label="Running" value={stats?.byStatus.running ?? 0} />
          <StatTile label="Succeeded" value={stats?.byStatus.succeeded ?? 0} />
          <StatTile
            label="Failed"
            value={failedCount}
            emphasis={failedCount > 0 ? 'error' : 'default'}
          />
          <StatTile
            label="Scheduled"
            value={stats?.scheduled ?? 0}
            hint="Waiting out a backoff"
          />
          <StatTile
            label="Stuck"
            value={stuckCount}
            emphasis={stuckCount > 0 ? 'warning' : 'default'}
            // The threshold comes from the response, never from a constant
            // here: it is a system setting, and a number invented in the UI
            // would disagree with the sweep the button below actually runs.
            hint={
              stats
                ? `Running over ${stats.stuckThresholdMinutes} min`
                : undefined
            }
          />
        </Stack>

        {/* ------------------------------------------------------------------
            QUEUE-WIDE ACTIONS. Page-level, never a selection toolbar — see the
            file header.
            ------------------------------------------------------------- */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          sx={{ mb: 2, alignItems: { sm: 'center' } }}
        >
          {canWrite && (
            <>
              <Tooltip
                title={
                  failedCount === 0
                    ? 'Nothing has failed'
                    : 'Move every failed job back to pending, queue-wide'
                }
              >
                {/* A disabled button fires no events, so the tooltip needs a
                    live wrapper to hang off — the standard MUI arrangement. */}
                <span>
                  <Button
                    variant="outlined"
                    startIcon={<ReplayIcon />}
                    disabled={failedCount === 0 || actions.isWorking}
                    onClick={() => setPendingSweep('retry-failed')}
                  >
                    Retry all failed
                  </Button>
                </span>
              </Tooltip>

              <Tooltip
                title={
                  stuckCount === 0
                    ? 'No running job has outlived its lease'
                    : 'Requeue jobs whose executor is gone'
                }
              >
                <span>
                  <Button
                    variant="outlined"
                    startIcon={<RestartAltIcon />}
                    disabled={stuckCount === 0 || actions.isWorking}
                    onClick={() => setPendingSweep('reset-stuck')}
                  >
                    Reset stuck
                  </Button>
                </span>
              </Tooltip>
            </>
          )}

          {Toolbar && <Toolbar />}

          <Box sx={{ flexGrow: 1 }} />

          {/* The sibling page, reachable from here as well as from the hub:
              "how long will this take" is the question an operator asks while
              looking at exactly this backlog. */}
          <Button
            startIcon={<InsightsIcon />}
            onClick={() => navigate(insightsPath)}
          >
            Job insights
          </Button>
        </Stack>

        {error && (
          <Alert severity="error" sx={{ mb: 2 }}>
            {error}
          </Alert>
        )}

        {Filters && (
          <Stack direction="row" spacing={1} useFlexGap sx={{ mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <Filters
              value={extraFilters}
              onChange={(next) => {
                setExtraFilters(next);
                setPage(0);
              }}
            />
          </Stack>
        )}

        <Paper sx={{ width: '100%', p: 2 }}>
          <Box sx={{ minWidth: 0 }}>
            <DataTable<Job>
              tableId={TABLE_ID}
              data-testid="admin-jobs-table"
              ariaLabel="Jobs"
              columns={columns}
              rows={jobs}
              rowId={(job) => job.id}
              loading={isLoading}
              emptyState={emptyState}
              pagination={{
                page,
                pageSize,
                total,
                // The API caps `pageSize` at 100, so no option here may exceed it.
                pageSizeOptions: [10, 20, 50, 100],
                onPaginationChange: (next) => {
                  setPage(next.page);
                  setPageSize(next.pageSize);
                },
              }}
              filters={filters}
              onFiltersChange={(next) => {
                setFilters((previous) => enforceExclusiveJobFilters(next, previous));
                setPage(0);
              }}
              rowActions={rowActions}
              csvExport={{
                filename: 'jobs',
                // Replays THIS page's own query, so an export can only ever
                // contain what the user's own list request already returns.
                fetchAllRows: async ({ page: exportPage, pageSize: exportPageSize }) => {
                  const response = await jobsApi.getJobs({
                    ...query,
                    page: exportPage + 1,
                    pageSize: exportPageSize,
                  });
                  return response.items;
                },
              }}
            />
          </Box>
          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
            Newest first. The queue is re-read every {JOBS_POLL_INTERVAL_MS / 1000} seconds while
            this tab is in front.
          </Typography>
        </Paper>

        {Sections && <Sections position="bottom" />}
        {AfterContent && <AfterContent />}

        {/* ------------------------------------------------------------------
            ONE CONFIRMATION FOR BOTH SWEEPS. Each acts on rows that are not on
            screen and cannot be undone by pressing the button again, which is
            the line between "a button" and "a button with a dialog".
            ------------------------------------------------------------- */}
        <Dialog open={pendingSweep !== null} onClose={() => setPendingSweep(null)}>
          <DialogTitle>
            {pendingSweep === 'retry-failed' ? 'Retry every failed job?' : 'Reset stuck jobs?'}
          </DialogTitle>
          <DialogContent>
            <DialogContentText>
              {pendingSweep === 'retry-failed'
                ? `${failedCount} failed job(s) will go back to pending with their attempt budgets ` +
                  'reset, across the whole queue — not just the rows shown here. At most 500 per ' +
                  'run.'
                : `${stuckCount} running job(s) whose executor has gone away will be requeued. ` +
                  'Jobs that have already spent their attempts will be failed permanently.'}
            </DialogContentText>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPendingSweep(null)}>Cancel</Button>
            <Button variant="contained" onClick={() => void runSweep()} disabled={actions.isWorking}>
              Continue
            </Button>
          </DialogActions>
        </Dialog>

        <Snackbar
          open={notice !== null}
          autoHideDuration={6000}
          onClose={() => setNotice(null)}
          message={notice}
        />
      </Box>
    </Container>
  );
}
