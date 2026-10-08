// The user Danger Zone (issue #743): kvox's two layers. Narrow scopes
// (`layer: 'specific'`) are rows with live counts, each disabled at zero;
// under a divider and an error-coloured heading come the composite scopes
// (`everything`, `content`). Every action opens the typed-confirmation dialog.
// The static lists render even if the summary request fails (EvoPath).

import type { ReactElement } from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Box, Button, Container, Divider, List, ListItem, ListItemText, Paper, Skeleton, Stack, Typography } from '@mui/material';
import {
  USER_DATA_CONTENT_CONFIRMATION,
  USER_DATA_CONTENT_SCOPE,
  USER_DATA_EVERYTHING_CONFIRMATION,
  USER_DATA_EVERYTHING_SCOPE,
  type UserDataPurgeResult,
  type UserDataScope,
  type UserDataSummary,
} from '@marinoscar/platform-contract/user-data';

import { usePlatformApi } from '../../core/index.js';
import { createUserDataClient, useDestructiveJob } from '../headless/index.js';
import { DANGER_ZONE_PAGE_DESCRIPTION, DANGER_ZONE_PAGE_TITLE, USER_DATA_KEPT } from './copy.js';
import { TypedConfirmDialog } from './TypedConfirmDialog.js';

/** The two built-in scopes, shown when the summary cannot be read. */
const FALLBACK_SCOPES: UserDataScope[] = [
  {
    id: USER_DATA_CONTENT_SCOPE,
    label: 'Delete my content',
    description: 'Everything you created, keeping your credentials and settings.',
    layer: 'danger',
    confirmation: USER_DATA_CONTENT_CONFIRMATION,
    categories: [],
  },
  {
    id: USER_DATA_EVERYTHING_SCOPE,
    label: 'Delete all my data',
    description: 'Everything you own, including access tokens and settings. Your account stays.',
    layer: 'danger',
    confirmation: USER_DATA_EVERYTHING_CONFIRMATION,
    categories: [],
  },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * Props of {@link UserDangerZonePage}.
 *
 * @stability experimental
 */
export interface UserDangerZonePageProps {
  /** Called after a deletion succeeds: clear client caches, refetch the profile and notifications. */
  onCompleted?(result: UserDataPurgeResult | null): void;
  /** Poll interval of the job status, in milliseconds. Default 1500. */
  pollIntervalMs?: number;
}

/**
 * The `/settings/danger-zone` page. See the file header.
 *
 * @param props - see {@link UserDangerZonePageProps}.
 *
 * @stability experimental
 * @extensionPoint component
 * @example
 * ```tsx
 * <Route path="/settings/danger-zone" element={<UserDangerZonePage onCompleted={refreshSession} />} />
 * ```
 */
export function UserDangerZonePage(props: UserDangerZonePageProps): ReactElement {
  const api = usePlatformApi();
  const client = useMemo(() => createUserDataClient(api), [api]);
  const [summary, setSummary] = useState<UserDataSummary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<UserDataScope | null>(null);

  const load = useCallback(async () => {
    try {
      setSummary(await client.summary());
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Could not load what you own');
    }
  }, [client]);

  useEffect(() => {
    void load();
  }, [load]);

  const job = useDestructiveJob<UserDataPurgeResult>({
    start: () => client.requestDeletion(selected!.id, selected!.confirmation),
    poll: (jobId) => client.deletionStatus(jobId),
    intervalMs: props.pollIntervalMs,
    onSucceeded: (result) => {
      props.onCompleted?.(result);
      void load();
    },
  });

  const scopes = summary?.scopes ?? FALLBACK_SCOPES;
  const countOf = (scope: UserDataScope) =>
    summary ? summary.categories.filter((c) => scope.categories.includes(c.id)).reduce((sum, c) => sum + c.count, 0) : null;
  const bytesOf = (scope: UserDataScope) =>
    summary?.categories.filter((c) => scope.categories.includes(c.id) && c.bytes !== null).reduce((sum, c) => sum + (c.bytes ?? 0), 0) ?? 0;
  const labelOf = (id: string) => summary?.categories.find((c) => c.id === id)?.label ?? id;
  const specific = scopes.filter((scope) => scope.layer === 'specific');
  const danger = scopes.filter((scope) => scope.layer === 'danger');
  const result = job.result;

  const close = () => {
    setSelected(null);
    job.reset();
  };

  return (
    <Container maxWidth="md">
      <Box sx={{ py: { xs: 2, sm: 4 } }}>
        <Typography variant="h4" component="h1" gutterBottom>
          {DANGER_ZONE_PAGE_TITLE}
        </Typography>
        <Typography color="text.secondary" sx={{ mb: 3 }}>
          {DANGER_ZONE_PAGE_DESCRIPTION} A deletion is permanent: there is no undo and no backup of your data.
        </Typography>
        {loadError && (
          <Alert severity="warning" sx={{ mb: 2 }}>
            Could not load what you own ({loadError}). You can still delete your data.
          </Alert>
        )}

        <Paper variant="outlined" sx={{ p: 2, mb: 3 }}>
          <Typography variant="h6" component="h2" gutterBottom>
            What you own
          </Typography>
          {summary ? (
            <List dense aria-label="What you own">
              {summary.categories.map((category) => (
                <ListItem key={category.id} disableGutters>
                  <ListItemText
                    primary={`${category.label}: ${category.count}${category.bytes ? ` (${formatBytes(category.bytes)})` : ''}`}
                    secondary={category.description}
                  />
                </ListItem>
              ))}
            </List>
          ) : loadError ? null : (
            <Skeleton variant="rectangular" height={80} aria-label="Loading" />
          )}
          <Typography variant="subtitle2" component="h3" sx={{ mt: 1 }}>
            Always kept
          </Typography>
          <List dense aria-label="Always kept">
            {USER_DATA_KEPT.map((line) => (
              <ListItem key={line} disableGutters>
                <ListItemText primary={line} />
              </ListItem>
            ))}
          </List>
        </Paper>

        {specific.length > 0 && (
          <Box component="section" aria-labelledby="ud-specific" sx={{ mb: 3 }}>
            <Typography id="ud-specific" variant="h6" component="h2" gutterBottom>
              Delete specific data
            </Typography>
            <Stack spacing={1}>
              {specific.map((scope) => {
                const count = countOf(scope);
                const bytes = bytesOf(scope);
                return (
                  <Paper key={scope.id} variant="outlined" sx={{ p: 2 }}>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 600 }}>{scope.label}</Typography>
                        <Typography variant="body2" color="text.secondary">
                          {scope.description}
                          {count !== null && ` ${count} item(s)${bytes ? `, ${formatBytes(bytes)}` : ''}.`}
                        </Typography>
                      </Box>
                      <Button variant="outlined" color="error" disabled={count === 0} onClick={() => setSelected(scope)}>
                        Delete
                      </Button>
                    </Stack>
                  </Paper>
                );
              })}
            </Stack>
          </Box>
        )}

        <Divider sx={{ my: 3 }} />
        <Box component="section" aria-labelledby="ud-danger">
          <Typography id="ud-danger" variant="h6" component="h2" color="error" gutterBottom>
            Danger zone
          </Typography>
          <Stack spacing={1}>
            {danger.map((scope) => (
              <Paper key={scope.id} variant="outlined" sx={{ p: 2, borderColor: 'error.main' }}>
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ alignItems: { sm: 'center' } }}>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 600 }}>{scope.label}</Typography>
                    <Typography variant="body2" color="text.secondary">
                      {scope.description}
                    </Typography>
                  </Box>
                  <Button variant="contained" color="error" onClick={() => setSelected(scope)}>
                    {scope.label}
                  </Button>
                </Stack>
              </Paper>
            ))}
          </Stack>
        </Box>

        <TypedConfirmDialog
          open={selected !== null}
          title={selected?.label ?? ''}
          description={
            <Typography>
              {selected?.description} This cannot be undone.
              {selected?.categories.length ? ` It deletes: ${selected.categories.map(labelOf).join(', ')}.` : ''}
            </Typography>
          }
          phrase={selected?.confirmation ?? ''}
          confirmLabel="Delete"
          phase={job.phase}
          error={job.error}
          resultRows={result ? Object.entries(result.categories).map(([id, count]) => ({ label: labelOf(id), count })) : []}
          storageObjectsFailed={result?.storageObjectsFailed ?? 0}
          onConfirm={() => void job.run()}
          onClose={close}
        />
      </Box>
    </Container>
  );
}
