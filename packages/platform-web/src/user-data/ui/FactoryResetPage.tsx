// The admin factory reset page (issue #743), as EvoPath's: an error-bordered
// warning, a backup-first link, the live counts and the static lists (which
// render even if the summary fails), and the typed-confirmation dialog. In
// `DEPLOYMENT_MODE=saas` the button is off and the page says why.

import type { ReactElement, ReactNode } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import { Alert, Box, Button, Container, Link, List, ListItem, ListItemText, Paper, Skeleton, Stack, Typography } from '@mui/material';
import {
  FACTORY_RESET_BACKUP_PATH,
  FACTORY_RESET_CONFIRMATION,
  USER_DATA_ERROR_CODES,
  type FactoryResetResult,
  type FactoryResetSummary,
} from '@marinoscar/platform-contract/user-data';

import { usePlatformApi } from '../../core/index.js';
import { createFactoryResetClient, useDestructiveJob } from '../headless/index.js';
import { FACTORY_RESET_DELETED, FACTORY_RESET_KEPT, FACTORY_RESET_PAGE_TITLE } from './copy.js';
import { TypedConfirmDialog } from './TypedConfirmDialog.js';

/** Readable labels of the flat result keys. */
function resultLabel(key: string): string {
  const fixed: Record<string, string> = {
    users: 'Users',
    jobs: 'Jobs',
    organizations: 'Organizations',
    storageObjectsDeleted: 'Stored files',
    workerNodesReassigned: 'Worker nodes reassigned to you',
    workerNodesRemoved: 'Worker nodes removed (name clash)',
    nodeCredentialsReassigned: 'Node credentials reassigned to you',
  };
  if (fixed[key]) return fixed[key];
  return key.replace(/^(category|model|step|orphans|hook)\./, '');
}

/**
 * Props of {@link FactoryResetPage}.
 *
 * @stability experimental
 */
export interface FactoryResetPageProps {
  /** Called after the reset succeeds: clear client caches and the shell's state. */
  onCompleted?(result: FactoryResetResult | null): void;
  /** Poll interval of the job status, in milliseconds. Default 1500. */
  pollIntervalMs?: number;
}

/**
 * The `/admin/settings/factory-reset` page. See the file header.
 *
 * @param props - see {@link FactoryResetPageProps}.
 *
 * @stability experimental
 * @extensionPoint component
 * @example
 * ```tsx
 * <Route path="/admin/settings/factory-reset" element={<FactoryResetPage onCompleted={refreshSession} />} />
 * ```
 */
export function FactoryResetPage(props: FactoryResetPageProps): ReactElement {
  const api = usePlatformApi();
  const client = useMemo(() => createFactoryResetClient(api), [api]);
  const [summary, setSummary] = useState<FactoryResetSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setSummary(await client.summary());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load the summary');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const job = useDestructiveJob<FactoryResetResult>({
    start: () => client.request(FACTORY_RESET_CONFIRMATION),
    poll: (jobId) => client.status(jobId),
    intervalMs: props.pollIntervalMs,
    onSucceeded: (result) => {
      props.onCompleted?.(result);
      void load();
    },
  });

  const disabled = summary?.disabledReason === USER_DATA_ERROR_CODES.FACTORY_RESET_DISABLED_IN_SAAS;
  const counts = job.result?.counts ?? {};
  const rows = Object.entries(counts)
    .filter(([key]) => key !== 'storageObjectsFailed')
    .map(([key, count]) => ({ label: resultLabel(key), count }));
  const line = (text: ReactNode, key: string) => (
    <ListItem key={key} disableGutters>
      <ListItemText primary={text} />
    </ListItem>
  );

  return (
    <Container maxWidth="md">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {FACTORY_RESET_PAGE_TITLE}
        </Typography>
        <Paper variant="outlined" sx={{ p: 2, mb: 3, borderColor: 'error.main', borderWidth: 2 }}>
          <Typography color="error" sx={{ fontWeight: 600 }} gutterBottom>
            This erases the whole application for everyone and cannot be undone.
          </Typography>
          <Typography>
            Take a database backup first: it is the only way back.{' '}
            <Link component={RouterLink} to={FACTORY_RESET_BACKUP_PATH}>
              Go to Database Backup
            </Link>
          </Typography>
        </Paper>
        {disabled && (
          <Alert severity="info" sx={{ mb: 2 }}>
            The factory reset is disabled in SaaS mode. Offboard organizations instead.
          </Alert>
        )}
        {loadError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Could not load the summary ({loadError}).
          </Alert>
        )}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mb: 3 }}>
          <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
            <Typography variant="h6" component="h2" gutterBottom>
              Deleted
            </Typography>
            {summary ? (
              <List dense aria-label="Counts">
                {line(`Other users: ${summary.otherUsers}`, 'users')}
                {line(`Organizations other than the default: ${summary.organizations}`, 'orgs')}
                {line(`Stored files: ${summary.storageObjects}`, 'objects')}
                {line(`Job history rows: ${summary.jobs}`, 'jobs')}
                {summary.categories.map((category) => line(`${category.label}: ${category.count}`, `c-${category.id}`))}
              </List>
            ) : loadError ? null : (
              <Skeleton variant="rectangular" height={80} aria-label="Loading" />
            )}
            <List dense aria-label="What is deleted">
              {FACTORY_RESET_DELETED.map((text) => line(text, text))}
            </List>
          </Paper>
          <Paper variant="outlined" sx={{ p: 2, flex: 1 }}>
            <Typography variant="h6" component="h2" gutterBottom>
              Kept
            </Typography>
            <List dense aria-label="What is kept">
              {FACTORY_RESET_KEPT.map((text) => line(text, text))}
            </List>
          </Paper>
        </Stack>
        <Button variant="contained" color="error" disabled={disabled} onClick={() => setOpen(true)}>
          Factory reset
        </Button>
        <TypedConfirmDialog
          open={open}
          title="Factory reset"
          description={
            <Typography>
              Every other user and all application data are deleted, for everyone. You stay signed in. Personal access tokens stop
              working, device logins in flight are lost, and other people need a new allowlist entry to sign in again.
            </Typography>
          }
          phrase={FACTORY_RESET_CONFIRMATION}
          confirmLabel="Factory reset"
          phase={job.phase}
          error={job.error}
          resultRows={rows}
          storageObjectsFailed={counts.storageObjectsFailed ?? 0}
          onConfirm={() => void job.run()}
          onClose={() => {
            setOpen(false);
            job.reset();
          }}
        />
      </Box>
    </Container>
  );
}
