/**
 * Admin → Operations → Deployment (`/admin/settings/deployment`).
 *
 * Issue #392, epic #388. A REGISTRY CARD and nothing else, per CLAUDE.md's
 * MANDATORY Settings UI Pattern: one entry in `ADMIN_SECTIONS`
 * (`config/adminSections.tsx`), one route in `App.tsx` gated on the same
 * permission string the API enforces (`deployment:read`), and no tab anywhere.
 * The hub, the Console rail and the compact AppBar title all pick this page up
 * from that single declaration.
 *
 * The question it answers is one an administrator currently has to SSH into a
 * box to answer: *what is actually running here, since when, and from which
 * commit?* Five sections, in the order somebody asks them:
 *
 *   1. **Last deployment** — when, install or update, which commit, which ref.
 *   2. **Serving** — the domain, the port, the proxy, and how long the
 *      certificate has left.
 *   3. **Host** — the machine `appctl deploy` ran on.
 *   4. **This API instance** — the CONTAINER answering this request.
 *   5. **History** — the deploys before this one.
 *
 * =============================================================================
 * READ-ONLY, AND NOT AS A PERMISSION DECISION
 * =============================================================================
 *
 * There is no write on this page for a holder of any permission, because there
 * is no write to make: a deployment is changed by running `appctl deploy` on
 * the server, and the state file this reads is that command's output. A control
 * here that appeared to change any of it would be lying. That is why this page
 * — alone among the Operations pages — has no `canWrite`, no disabled controls
 * and no "(read-only)" suffix on its subtitle: those exist on `JobsPage`,
 * `WorkersPage` and `DbBackupPage` to explain a control set that CHANGES with
 * the viewer's permissions, and nothing here changes with anything.
 *
 * =============================================================================
 * ⚠ THREE DIFFERENT "NOTHING TO SHOW", AND THEY MUST NOT LOOK ALIKE
 * =============================================================================
 *
 *   1. **Loading** — a spinner. Says nothing either way.
 *   2. **`configured: false`** — a CALM, EXPLANATORY panel. The endpoint
 *      answered 200; there is simply no state file, which is the ordinary case
 *      for a development stack or for a container the file is not mounted into.
 *      Drawing this as an error would send an administrator hunting a fault
 *      that does not exist, and it is the single most likely state this page is
 *      ever seen in. The "This API instance" section still renders under it,
 *      because that part is known whatever the state file says.
 *   3. **A failed request** — an error alert. A 403, a 500, a dropped
 *      connection. `hooks/useDeployment.ts` is where the two are kept apart;
 *      this page only has to draw them differently.
 *
 * =============================================================================
 * A V1 STATE FILE HAS NO HOST, NO PROXY AND NO HISTORY
 * =============================================================================
 *
 * All three are genuinely optional, and a deployment installed before they
 * existed gains them on its next `appctl deploy update`. Each section is
 * therefore ABSENT rather than rendered empty: three headings over three em
 * dashes reads as data loss, whereas a page that simply does not have a Host
 * section reads as a page with nothing to say about the host. The one thing
 * that would be wrong is silence about WHY, so the Last deployment section
 * carries the state file's schema version.
 *
 * =============================================================================
 * ⚠ EVERY VALUE HERE CAME OUT OF A FILE ON A SERVER'S DISK
 * =============================================================================
 *
 * Not from a database column with a constraint on it. `repoUrl` may be an
 * `ssh://` or `git@` remote, which is not a web address at all, and a
 * hand-edited file could carry anything. NOTHING on this page is interpolated
 * into an `href` directly: `deploymentCommitUrl` and `deploymentDomainUrl`
 * (`services/deployment.ts`) are the only two functions permitted to build one,
 * both demand `https:`, and both return `null` — which renders as plain text —
 * rather than guessing. There is no `dangerouslySetInnerHTML` anywhere in this
 * subtree, and there must never be.
 */

import { Fragment, useMemo } from 'react';
import type { ReactNode } from 'react';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Chip,
  Container,
  Link,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutlineOutlined';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import RefreshIcon from '@mui/icons-material/Refresh';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import { Navigate } from 'react-router-dom';
import { DataTable } from '../../components/datatable';
import { LoadingSpinner } from '../../components/common/LoadingSpinner';
import { usePermissions } from '../../hooks/usePermissions';
import { useDeployment } from '../../hooks/useDeployment';
import {
  CERT_EXPIRY_WARNING_DAYS,
  DEPLOYMENT_COMMAND_LABELS,
  DEPLOYMENT_SOURCE_REASONS,
  certExpiry,
  deploymentCommitUrl,
  deploymentDomainUrl,
  deploymentRepoUrl,
  formatMemoryBytes,
  shortCommitSha,
} from '../../services/deployment';
import type {
  DeploymentRecord,
  DeploymentResponse,
  DeploymentRuntime,
} from '../../services/deployment';
import { formatRelativeTime } from '../../utils/relativeTime';
import { formatDateTime } from './jobsTable';
import {
  DEPLOYMENT_HISTORY_TABLE_ID,
  buildDeploymentHistoryColumns,
  toHistoryRows,
} from './deploymentTable';

/** Mirrors the `Deployment` card in `config/adminSections.tsx`, word for word. */
const PAGE_TITLE = 'Deployment';
const PAGE_DESCRIPTION =
  'See when this deployment was last installed or updated, from which commit, and on what server.';

// =============================================================================
// Layout primitives — local on purpose
// =============================================================================

/** One label/value pair. `value` is a node so a fact can carry a link or a chip. */
interface Fact {
  label: string;
  value: ReactNode;
}

/**
 * A definition list, as a two-column grid on anything wider than a phone and a
 * single stacked column on a phone.
 *
 * A REAL `<dl>`/`<dt>`/`<dd>`, not a `<Grid>` of `<Typography>`: the whole page
 * is label/value pairs, and the pairing is the meaning. A screen reader
 * navigating a definition list announces "Commit, a1b2c3d" as one unit; the
 * same thing built out of grid cells announces two unrelated strings and leaves
 * the reader to infer which label owned which value from a visual layout they
 * are not receiving.
 *
 * `overflowWrap: 'anywhere'` on the value because several of these are long
 * unbroken strings a file supplied — a 40-character sha, a deploy root, a
 * kernel version — and a phone-width column must wrap them rather than push the
 * page sideways.
 *
 * Kept local rather than shared: it is a dozen lines of layout, and a shared
 * "fact list" is the component that grows a `variant` prop per caller — the
 * same argument `WorkersPage`'s `StatTile` makes for staying local.
 */
function FactList({ facts }: { facts: Fact[] }) {
  return (
    <Box
      component="dl"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'minmax(140px, 30%) 1fr' },
        columnGap: 3,
        rowGap: { xs: 1.5, sm: 1.25 },
        m: 0,
      }}
    >
      {facts.map((fact) => (
        <Fragment key={fact.label}>
          <Typography component="dt" variant="body2" color="text.secondary">
            {fact.label}
          </Typography>
          <Typography
            component="dd"
            variant="body2"
            sx={{ m: 0, minWidth: 0, overflowWrap: 'anywhere' }}
          >
            {fact.value}
          </Typography>
        </Fragment>
      ))}
    </Box>
  );
}

/** One titled panel. `h2` under the page's `h1`, so the page has a real outline. */
function Section({
  title,
  subtitle,
  testId,
  children,
}: {
  title: string;
  subtitle?: ReactNode;
  testId: string;
  children: ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: { xs: 2, sm: 3 }, mb: 3 }} data-testid={testId}>
      <Typography variant="h6" component="h2">
        {title}
      </Typography>
      {subtitle && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2 }}>
          {subtitle}
        </Typography>
      )}
      <Box sx={{ mt: subtitle ? 0 : 2 }}>{children}</Box>
    </Paper>
  );
}

/** A value the API did not send. An em dash, never a blank cell. */
const NONE = <Typography component="span" color="text.secondary">—</Typography>;

/**
 * A commit, short and linked when the repository URL is a real `https:` web
 * address — with the FULL sha on the line beneath it either way.
 *
 * The full sha is present rather than hidden behind a tooltip because the thing
 * an administrator does with it is PASTE it: into `git show`, into a colleague's
 * message, into an incident write-up. A tooltip is not selectable text, and a
 * value you cannot copy is one somebody re-types wrong.
 */
function CommitValue({ sha, repoUrl }: { sha: string; repoUrl: string | null }) {
  const href = deploymentCommitUrl(repoUrl, sha);

  return (
    <Stack spacing={0.25} sx={{ minWidth: 0 }}>
      {href ? (
        <Link
          href={href}
          target="_blank"
          rel="noopener noreferrer"
          sx={{ fontFamily: 'monospace', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
        >
          {shortCommitSha(sha)}
          <OpenInNewIcon fontSize="inherit" aria-hidden />
        </Link>
      ) : (
        <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace' }}>
          {shortCommitSha(sha)}
        </Typography>
      )}
      <Typography
        component="span"
        variant="caption"
        color="text.secondary"
        sx={{ fontFamily: 'monospace', overflowWrap: 'anywhere' }}
      >
        {sha}
      </Typography>
    </Stack>
  );
}

/**
 * The certificate's expiry, as a date PLUS a verdict.
 *
 * ⚠ NEVER COLOUR ALONE. An expired or nearly-expired certificate is the one
 * thing on this page somebody has to act on, so the warning is carried by an
 * ICON, by the WORDS ("Expired", "Expires in 9 days") and by the colour — in
 * that order of importance. A reader who cannot distinguish this theme's
 * warning orange from its body text still gets the whole message from the text.
 */
function CertExpiryValue({ certNotAfter, now }: { certNotAfter?: string; now: Date }) {
  const expiry = certExpiry(certNotAfter, now);

  if (expiry.level === 'unknown') {
    return (
      <Typography component="span" variant="body2" color="text.secondary">
        Not reported
      </Typography>
    );
  }

  const absolute = formatDateTime(certNotAfter);

  if (expiry.level === 'ok') {
    return (
      <Typography component="span" variant="body2">
        {absolute}
        <Typography component="span" variant="body2" color="text.secondary">
          {` (in ${expiry.days} days)`}
        </Typography>
      </Typography>
    );
  }

  const expired = expiry.level === 'expired';
  const days = expiry.days ?? 0;

  return (
    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', alignItems: 'center' }}>
      <Chip
        size="small"
        color={expired ? 'error' : 'warning'}
        variant={expired ? 'filled' : 'outlined'}
        icon={expired ? <ErrorOutlineIcon fontSize="small" /> : <WarningAmberIcon fontSize="small" />}
        label={
          expired
            ? `Expired ${Math.abs(days)} ${Math.abs(days) === 1 ? 'day' : 'days'} ago`
            : `Expires in ${days} ${days === 1 ? 'day' : 'days'}`
        }
      />
      <Typography component="span" variant="body2">
        {absolute}
      </Typography>
    </Stack>
  );
}

// =============================================================================
// Sections
// =============================================================================

/**
 * The headline: when this deployment last changed, and to what.
 *
 * The timestamp is BOTH relative and absolute, and neither is optional. "3
 * hours ago" is the answer to the question somebody actually has ("is this
 * current?"); the absolute timestamp is what they put in the incident timeline,
 * and it is the only one that still means anything when the page has been open
 * on a wall display since yesterday.
 */
function LastDeploymentSection({
  record,
  repoUrl,
  now,
}: {
  record: DeploymentRecord;
  repoUrl: string | null;
  now: Date;
}) {
  const facts: Fact[] = [
    {
      label: 'Last deployed',
      value: (
        <Stack spacing={0.25}>
          <Typography component="span" variant="body2">
            {formatRelativeTime(record.lastDeployedAt, now)}
          </Typography>
          <Typography component="span" variant="caption" color="text.secondary">
            {formatDateTime(record.lastDeployedAt)}
          </Typography>
        </Stack>
      ),
    },
    {
      label: 'Command',
      value: (
        <Chip
          size="small"
          variant="outlined"
          label={DEPLOYMENT_COMMAND_LABELS[record.lastCommand]}
        />
      ),
    },
    { label: 'Commit', value: <CommitValue sha={record.commitSha} repoUrl={repoUrl} /> },
    {
      label: 'Previous commit',
      value: record.previousSha ? (
        <CommitValue sha={record.previousSha} repoUrl={repoUrl} />
      ) : (
        // A first install genuinely has no predecessor. Said in words rather
        // than left as an em dash, because "nothing was replaced" and "we do
        // not know what was replaced" are different answers.
        <Typography component="span" variant="body2" color="text.secondary">
          None — this is the first install
        </Typography>
      ),
    },
    { label: 'Ref', value: record.ref },
    {
      label: 'Repository',
      value: repoUrl ? (
        <Link href={repoUrl} target="_blank" rel="noopener noreferrer">
          {record.repoUrl}
        </Link>
      ) : (
        // Shown as text, not as a broken link: an `ssh://` or `git@` remote is
        // still exactly the information somebody wants, it is simply not a web
        // address. See `deploymentRepoUrl`.
        <Typography component="span" variant="body2" sx={{ fontFamily: 'monospace' }}>
          {record.repoUrl}
        </Typography>
      ),
    },
    { label: 'appctl version', value: record.appctlVersion },
    {
      label: 'First installed',
      value: (
        <Stack spacing={0.25}>
          <Typography component="span" variant="body2">
            {formatRelativeTime(record.installedAt, now)}
          </Typography>
          <Typography component="span" variant="caption" color="text.secondary">
            {formatDateTime(record.installedAt)}
          </Typography>
        </Stack>
      ),
    },
    { label: 'Deploy root', value: record.deployRoot },
    {
      // The schema version, said out loud, because it is the answer to "why is
      // there no Host section" — see the file header.
      label: 'State file version',
      value: `v${record.version}`,
    },
  ];

  return (
    <Section
      title="Last deployment"
      subtitle="What `appctl deploy` last did on this server, and what it put there."
      testId="deployment-last"
    >
      <FactList facts={facts} />
    </Section>
  );
}

/** Where traffic arrives, and whether the certificate in front of it is healthy. */
function ServingSection({ record, now }: { record: DeploymentRecord; now: Date }) {
  const proxy = record.proxy;
  const domain = proxy?.domain ?? record.domain;
  const domainUrl = deploymentDomainUrl(domain);

  const facts: Fact[] = [
    {
      label: 'Domain',
      value: domain ? (
        domainUrl ? (
          <Link
            href={domainUrl}
            target="_blank"
            rel="noopener noreferrer"
            sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
          >
            {domain}
            <OpenInNewIcon fontSize="inherit" aria-hidden />
          </Link>
        ) : (
          <Typography component="span" variant="body2">
            {domain}
          </Typography>
        )
      ) : (
        <Typography component="span" variant="body2" color="text.secondary">
          None — reached by IP address
        </Typography>
      ),
    },
    { label: 'Bind port', value: String(proxy?.bindPort ?? record.bindPort) },
  ];

  if (proxy) {
    facts.push(
      // Optional on the wire: a proxy terminating on the host itself has no
      // container name to report. See `DeploymentProxy.container`.
      { label: 'Proxy container', value: proxy.container ?? NONE },
      {
        label: 'Proxy mode',
        value: proxy.mode === 'container' ? 'Container' : 'Host',
      },
      {
        label: 'Certificate expires',
        value: <CertExpiryValue certNotAfter={proxy.certNotAfter} now={now} />,
      },
    );
  }

  return (
    <Section
      title="Serving"
      subtitle={
        proxy
          ? 'How requests reach this deployment.'
          : // A v1 state file records the domain and the port but nothing about
            // the proxy in front of them. Saying so is better than a Proxy row
            // reading "—", which looks like a proxy that failed to report.
            'How requests reach this deployment. This state file predates proxy details, so only the domain and port are recorded.'
      }
      testId="deployment-serving"
    >
      <FactList facts={facts} />
      {proxy?.certNotAfter && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 2, display: 'block' }}>
          A certificate is flagged here once it is within {CERT_EXPIRY_WARNING_DAYS} days of
          expiring.
        </Typography>
      )}
    </Section>
  );
}

/** The machine itself. Absent entirely from a v1 state file. */
function HostSection({ record }: { record: DeploymentRecord }) {
  const host = record.host;
  if (!host) return null;

  const facts: Fact[] = [
    { label: 'Hostname', value: host.hostname },
    { label: 'Operating system', value: host.os },
    { label: 'Kernel', value: host.kernel },
    { label: 'Architecture', value: host.arch },
    { label: 'CPUs', value: String(host.cpus) },
    { label: 'Memory', value: formatMemoryBytes(host.memoryBytes) },
    { label: 'Docker', value: host.dockerVersion },
    { label: 'Compose', value: host.composeVersion },
    { label: 'Public IP', value: host.publicIp ?? NONE },
  ];

  return (
    <Section
      title="Host"
      subtitle="The server `appctl deploy` ran on, as it reported itself at that moment."
      testId="deployment-host"
    >
      <FactList facts={facts} />
    </Section>
  );
}

/**
 * The process answering this request.
 *
 * ⚠ THE LABELLING IS THE WHOLE POINT OF THIS SECTION. `runtime.hostname` is the
 * API CONTAINER's hostname — a short random id on a compose deployment — and
 * the Host section above carries the SERVER's. Two hostnames in one response
 * that mean different machines is exactly the confusion this heading and its
 * subtitle exist to prevent, and it is why "Container hostname" is spelled out
 * rather than left as "Hostname".
 *
 * It renders even when there is no deployment record at all, because it is the
 * one part of this page that is known whatever the state file says.
 */
function ApiInstanceSection({ runtime, now }: { runtime: DeploymentRuntime; now: Date }) {
  const facts: Fact[] = [
    { label: 'API version', value: runtime.apiVersion },
    { label: 'Environment', value: runtime.nodeEnv },
    { label: 'Node.js version', value: runtime.nodeVersion },
    { label: 'Container hostname', value: runtime.hostname },
    {
      label: 'Process started',
      value: (
        <Stack spacing={0.25}>
          <Typography component="span" variant="body2">
            {formatRelativeTime(runtime.startedAt, now)}
          </Typography>
          <Typography component="span" variant="caption" color="text.secondary">
            {formatDateTime(runtime.startedAt)}
          </Typography>
        </Stack>
      ),
    },
  ];

  return (
    <Section
      title="This API instance"
      subtitle="The running API container that answered this request — not the server it runs on. It restarts without the deployment changing."
      testId="deployment-runtime"
    >
      <FactList facts={facts} />
    </Section>
  );
}

/** Every deploy before this one. Absent entirely from a v1 state file. */
function HistorySection({
  record,
  repoUrl,
  now,
}: {
  record: DeploymentRecord;
  repoUrl: string | null;
  now: Date;
}) {
  const rows = useMemo(() => toHistoryRows(record.history), [record.history]);
  const columns = useMemo(
    () => buildDeploymentHistoryColumns(now, repoUrl),
    [now, repoUrl],
  );

  if (!record.history) return null;

  return (
    <Section
      title="History"
      subtitle="Previous deploys, newest first, as recorded in the state file."
      testId="deployment-history"
    >
      <Box sx={{ minWidth: 0 }}>
        <DataTable
          tableId={DEPLOYMENT_HISTORY_TABLE_ID}
          data-testid="admin-deployment-history-table"
          ariaLabel="Deployment history"
          columns={columns}
          rows={rows}
          rowId={(row) => row.id}
          emptyState={
            <Typography color="text.secondary">
              No previous deploys have been recorded yet.
            </Typography>
          }
          // No `pagination`, no `sort`, no `filters`, and no row actions: the
          // history is a bounded array inside the response, there is no
          // endpoint to send a sort key to, and there is nothing on this page
          // to act on. See `deploymentTable.tsx`.
          csvExport={{ filename: 'deployment-history' }}
        />
      </Box>
    </Section>
  );
}

/**
 * The `configured: false` panel.
 *
 * ⚠ `severity="info"`, NOT `warning` AND NOT `error`. The endpoint answered
 * 200 and the application is working perfectly; it simply was not installed by
 * `appctl deploy`, or the state file is not mounted into this container. This
 * is the ordinary state for every development stack, and an administrator who
 * arrives here during an incident must not be handed a red box that sends them
 * looking for a fault that is not there.
 */
function NotConfiguredPanel({ source }: { source: DeploymentResponse['source'] }) {
  const reason = source.reason ? DEPLOYMENT_SOURCE_REASONS[source.reason] : null;

  return (
    <Alert severity="info" sx={{ mb: 3 }} data-testid="deployment-not-configured">
      <AlertTitle>No deployment record for this instance</AlertTitle>
      <Typography variant="body2" sx={{ mb: 1 }}>
        {reason ??
          'This API instance has no deployment record to show.'}
      </Typography>
      {source.path && (
        <Typography variant="body2" sx={{ mb: 1, overflowWrap: 'anywhere' }}>
          Looked for it at <Box component="code">{source.path}</Box>.
        </Typography>
      )}
      <Typography variant="body2">
        Nothing is wrong with the application — it runs the same either way. What is known
        about the running container is below.
      </Typography>
    </Alert>
  );
}

// =============================================================================
// The page
// =============================================================================

export default function DeploymentPage() {
  const { hasPermission } = usePermissions();
  const { deployment, isLoading, loadError, refresh } = useDeployment();

  /**
   * ONE CLOCK FOR THE WHOLE RENDER, taken from the response rather than read
   * per cell: five relative timestamps and a certificate verdict are all
   * measured against it, and a page that called `new Date()` in each of them
   * can render two deploys from the same second as "1 minute ago" and "2
   * minutes ago". Keyed on the loaded record so a refresh re-dates the page.
   */
  const now = useMemo(() => new Date(), [deployment]);

  const record = deployment?.deployment;
  // The ONE place the repository URL is validated for this page; every link
  // built below and in the history table goes through the result.
  const repoUrl = useMemo(() => deploymentRepoUrl(record?.repoUrl), [record?.repoUrl]);

  // Defence, not the gate — `App.tsx` wraps the route in `RequirePermission`
  // with this same string, exactly as every sibling admin page does. It sits
  // after every hook so the hook order never changes.
  if (!hasPermission('deployment:read')) {
    return <Navigate to="/" replace />;
  }

  return (
    <Container maxWidth="lg">
      <Box sx={{ py: 4 }}>
        {/* Title and description MIRROR the registry card so the hub card, the
            rail row, the compact AppBar title and this `h1` all name the page
            identically. */}
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={2}
          sx={{ mb: 3, alignItems: 'flex-start', justifyContent: 'space-between' }}
        >
          <Box>
            <Typography variant="h4" component="h1" gutterBottom>
              {PAGE_TITLE}
            </Typography>
            <Typography color="text.secondary">{PAGE_DESCRIPTION}</Typography>
          </Box>
          {/* Not a write. This page does not poll — a deployment changes when
              somebody runs a command on the server, not on its own — so the
              refresh is explicit rather than implied by a timer. */}
          <Button
            variant="outlined"
            startIcon={<RefreshIcon />}
            onClick={() => void refresh()}
            disabled={isLoading}
            sx={{ flexShrink: 0 }}
          >
            Refresh
          </Button>
        </Stack>

        {isLoading && !deployment && <LoadingSpinner />}

        {/* A GENUINE FAILURE — a 403, a 500, a dropped connection. Distinct
            from `configured: false` below, which is a successful answer. */}
        {loadError && (
          <Alert severity="error" sx={{ mb: 3 }}>
            {loadError}
          </Alert>
        )}

        {deployment && (
          <>
            {!deployment.configured && <NotConfiguredPanel source={deployment.source} />}

            {record && (
              <>
                <LastDeploymentSection record={record} repoUrl={repoUrl} now={now} />
                <ServingSection record={record} now={now} />
                <HostSection record={record} />
              </>
            )}

            {/* ALWAYS RENDERED, including under the not-configured panel: this
                is the part that is known whatever the state file says. */}
            <ApiInstanceSection runtime={deployment.runtime} now={now} />

            {record && <HistorySection record={record} repoUrl={repoUrl} now={now} />}
          </>
        )}
      </Box>
    </Container>
  );
}
