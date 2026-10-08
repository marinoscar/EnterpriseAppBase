/**
 * Reference examples of the jobs slice's extension points (#854): the data
 * hooks the packaged Jobs, Job Insights and Worker Nodes pages are built on,
 * used for "another view" of the same records, and the pages' header slot.
 * The extension-point catalog of `@marinoscar/platform-web/jobs` links each
 * row here.
 *
 * Not mounted by this app: each is a small summary chip or binding a fork
 * could drop into a page or a dashboard card. They read through the jobs
 * client the app hands `JobsWebAdaptersProvider` (`platform/jobsAdapters.ts`),
 * so they carry the app's bearer token, refresh and maintenance handling, and
 * the API enforces the same permissions it enforces for the packaged pages
 * (`jobs:read`/`jobs:write`, `nodes:read`/`nodes:write`).
 */
import { useEffect } from 'react';
import { Button, Chip, Stack, Typography } from '@mui/material';
import {
  JOBS_POLL_INTERVAL_MS,
  nodeCredentialStatus,
  useJobActions,
  useJobInsights,
  useJobStats,
  useJobs,
  useNodeActions,
  useNodeCredentials,
  useVisiblePolling,
  useWorkerNode,
  useWorkerNodes,
} from '@marinoscar/platform-web/jobs/headless';
import { JobInsightsPage, JobsPage, WorkersPage } from '@marinoscar/platform-web/jobs/ui';
import type { JobsPageHeaderProps } from '@marinoscar/platform-web/jobs/ui';

function SummaryChip({ label, isLoading, error }: { label: string; isLoading: boolean; error: string | null }) {
  return <Chip size="small" color={error ? 'error' : 'default'} label={isLoading ? '…' : (error ?? label)} />;
}

/** One organization's failed jobs, counted (`useJobs` with the `orgId` filter, #734). */
export function OrgFailedJobsSummary({ orgId }: { orgId: string }) {
  const { total, isLoading, error, fetchJobs, refresh } = useJobs();
  useEffect(() => {
    void fetchJobs({ orgId, status: 'failed', pageSize: 1 });
  }, [fetchJobs, orgId]);
  // A live count, re-read while the tab is in front (`useVisiblePolling`).
  useVisiblePolling(() => void refresh(), JOBS_POLL_INTERVAL_MS);
  return <SummaryChip label={`${total} failed jobs`} isLoading={isLoading} error={error} />;
}

/** The queue's pending work, from the summary (`useJobStats`). */
export function QueuePendingSummary() {
  const { stats, isLoading, error } = useJobStats();
  return <SummaryChip label={`${stats?.byStatus.pending ?? 0} pending jobs`} isLoading={isLoading} error={error} />;
}

/** A one-click queue-wide retry for a dashboard card (`useJobActions`). */
export function RetryAllFailedButton() {
  const { retryAllFailed, isWorking, error } = useJobActions();
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      <Button size="small" disabled={isWorking} onClick={() => void retryAllFailed()}>
        Retry all failed
      </Button>
      {error && <Typography color="error">{error}</Typography>}
    </Stack>
  );
}

/** The slowest outstanding estimate over the last day (`useJobInsights`). */
export function SlowestEtaSummary() {
  const { insights, isLoading, error } = useJobInsights(1);
  const slowest = insights?.eta[0];
  return (
    <SummaryChip
      label={slowest ? `${slowest.label}: ${slowest.remaining} outstanding` : 'Nothing outstanding'}
      isLoading={isLoading}
      error={error}
    />
  );
}

/** Healthy nodes out of the fleet (`useWorkerNodes`). */
export function FleetHealthSummary() {
  const { nodes, isLoading, error } = useWorkerNodes();
  const healthy = nodes.filter((node) => node.health === 'healthy').length;
  return <SummaryChip label={`${healthy}/${nodes.length} nodes healthy`} isLoading={isLoading} error={error} />;
}

/** One machine's health, for a node's own page (`useWorkerNode`). */
export function NodeHealthChip({ nodeId }: { nodeId: string }) {
  const { node, isLoading, error } = useWorkerNode(nodeId);
  return <SummaryChip label={node ? `${node.name}: ${node.health}` : 'Unknown node'} isLoading={isLoading} error={error} />;
}

/** Node credentials that can still authenticate (`useNodeCredentials`). */
export function ActiveNodeCredentialsSummary() {
  const { credentials, isLoading, error } = useNodeCredentials();
  const active = credentials.filter((credential) => nodeCredentialStatus(credential) === 'active').length;
  return <SummaryChip label={`${active} active node credentials`} isLoading={isLoading} error={error} />;
}

/** Revoke one credential from an incident checklist (`useNodeActions`). */
export function RevokeNodeCredentialButton({ credentialId, onRevoked }: { credentialId: string; onRevoked?: () => void }) {
  const { revokeCredential, isWorking } = useNodeActions(onRevoked);
  return (
    <Button size="small" color="error" disabled={isWorking} onClick={() => void revokeCredential(credentialId)}>
      Revoke
    </Button>
  );
}

/** A compact heading for the three pages (the `slots.Header` slot). */
function CompactHeader({ title, description, readOnly }: JobsPageHeaderProps) {
  return (
    <Stack sx={{ mb: 2 }}>
      <Typography variant="h5" component="h1">
        {title}
        {readOnly ? ' (read-only)' : ''}
      </Typography>
      <Typography variant="body2" color="text.secondary">
        {description}
      </Typography>
    </Stack>
  );
}

/** The Jobs page with a compact header and its insights button pointed elsewhere. */
export function CompactJobsPage() {
  return <JobsPage slots={{ Header: CompactHeader }} insightsPath="/ops/insights" />;
}

/** The Job Insights page with a compact header. */
export function CompactJobInsightsPage() {
  return <JobInsightsPage slots={{ Header: CompactHeader }} fallbackPath="/ops" />;
}

/** The Worker Nodes page with a compact header. */
export function CompactWorkersPage() {
  return <WorkersPage slots={{ Header: CompactHeader }} />;
}
