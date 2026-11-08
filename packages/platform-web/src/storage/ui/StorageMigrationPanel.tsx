/**
 * The copy-only storage provider migration panel of `StorageConfigPage`
 * (issue #1093).
 *
 * An administrator picks the driver to copy FROM and the driver to copy TO and
 * starts a run; the panel shows the active run's live progress (it polls while
 * the run is pending or running) with a Cancel button, and the recent run
 * history below. Copying never deletes anything: every source object stays
 * where it was, as a fallback, and only verified copies are repointed.
 *
 * Writes are gated inside the panel on `canWrite` (`storage_config:write`); a
 * reader sees the progress and the history only.
 */

import { useEffect, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Chip,
  FormControl,
  InputLabel,
  LinearProgress,
  MenuItem,
  Paper,
  Select,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';

import { NUMERIC_DATE_TIME, formatDateTime, useDisplayTimeZone } from '../../core/index.js';
import type { PlatformApiClient } from '../../core/index.js';
import { useStorageMigrations } from '../headless/index.js';
import type { StorageMigrationRun } from '../headless/index.js';

/**
 * One driver the panel offers.
 *
 * @stability experimental
 */
export interface StorageMigrationDriverOption {
  /** The driver id. */
  id: string;
  /** Its label. */
  label: string;
}

/**
 * Props of {@link StorageMigrationPanel}.
 *
 * @stability experimental
 */
export interface StorageMigrationPanelProps {
  /** The registered drivers (the configuration's descriptors). */
  drivers: StorageMigrationDriverOption[];
  /** The active driver: the default target. */
  activeProvider: string;
  /** `storage_config:write`: may start and cancel. */
  canWrite: boolean;
  /** The transport, outside a `PlatformHostProvider`. */
  api?: PlatformApiClient;
  /** Poll interval while a run is active, in ms (tests shorten it). */
  pollMs?: number;
}

const STATUS_COLORS: Record<string, 'default' | 'info' | 'success' | 'error' | 'warning'> = {
  pending: 'info',
  running: 'info',
  completed: 'success',
  failed: 'error',
  cancelled: 'warning',
};

function done(run: StorageMigrationRun): number {
  return run.migratedCount + run.failedCount + run.skippedCount;
}

function RunProgress({ run }: { run: StorageMigrationRun }) {
  const percent = run.totalCount > 0 ? Math.round((done(run) / run.totalCount) * 100) : 0;
  const planning = run.plannedAt === null;
  return (
    <Box data-testid="storage-migration-progress">
      <LinearProgress
        variant={planning && run.totalCount === 0 ? 'indeterminate' : 'determinate'}
        value={percent}
        aria-label="Migration progress"
      />
      <Typography variant="body2" sx={{ mt: 1 }}>
        {planning ? 'Listing objects… ' : ''}
        {done(run)} of {run.totalCount} processed: {run.migratedCount} migrated, {run.failedCount} failed, {run.skippedCount} skipped
        {run.pendingCount > 0 ? `, ${run.pendingCount} to go` : ''}
      </Typography>
    </Box>
  );
}

/**
 * Starts, follows and cancels a copy-only storage provider migration, and lists the recent runs.
 *
 * @param props - the drivers, the active one, write access and the transport.
 * @returns the panel.
 *
 * @stability experimental
 */
export function StorageMigrationPanel(props: StorageMigrationPanelProps) {
  const { drivers, activeProvider, canWrite } = props;
  useDisplayTimeZone(); // "Started" renders in the display zone.
  const { runs, activeRun, isLoading, loadError, isWorking, actionError, clearActionError, start, cancel } = useStorageMigrations({
    ...(props.api ? { api: props.api } : {}),
    ...(props.pollMs !== undefined ? { pollMs: props.pollMs } : {}),
  });

  const [target, setTarget] = useState(activeProvider);
  const [source, setSource] = useState(() => drivers.find((d) => d.id !== activeProvider)?.id ?? '');

  useEffect(() => {
    setTarget(activeProvider);
  }, [activeProvider]);

  const canStart = canWrite && !activeRun && !isWorking && !!source && !!target && source !== target;

  return (
    <Paper sx={{ mt: 2, p: { xs: 2, sm: 3 } }} data-testid="storage-migration-panel">
      <Typography variant="h6" component="h2">
        Copy objects between providers
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        Copies every stored object from one provider to another, verifies each copy (size and checksum), and only then
        points the object at its new home. Nothing is deleted: the original stays where it is as a fallback. One
        migration runs at a time.
      </Typography>

      {loadError && (
        <Alert severity="error" sx={{ mt: 2 }}>
          {loadError}
        </Alert>
      )}
      {actionError && (
        <Alert severity="error" sx={{ mt: 2 }} onClose={clearActionError}>
          {actionError}
        </Alert>
      )}

      {canWrite && (
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} sx={{ mt: 2, alignItems: { sm: 'center' } }}>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="storage-migration-source-label">From</InputLabel>
            <Select
              labelId="storage-migration-source-label"
              label="From"
              value={source}
              onChange={(event) => setSource(String(event.target.value))}
              inputProps={{ 'data-testid': 'storage-migration-source' }}
            >
              {drivers.map((driver) => (
                <MenuItem key={driver.id} value={driver.id}>
                  {driver.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <FormControl size="small" sx={{ minWidth: 180 }}>
            <InputLabel id="storage-migration-target-label">To</InputLabel>
            <Select
              labelId="storage-migration-target-label"
              label="To"
              value={target}
              onChange={(event) => setTarget(String(event.target.value))}
              inputProps={{ 'data-testid': 'storage-migration-target' }}
            >
              {drivers.map((driver) => (
                <MenuItem key={driver.id} value={driver.id}>
                  {driver.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <Button
            variant="contained"
            disabled={!canStart}
            onClick={() => void start({ sourceProvider: source, targetProvider: target })}
          >
            Start migration
          </Button>
        </Stack>
      )}

      {activeRun && (
        <Box sx={{ mt: 3 }}>
          <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center', flexWrap: 'wrap' }}>
            <Typography variant="subtitle1">
              {activeRun.sourceProvider} → {activeRun.targetProvider}
            </Typography>
            <Chip size="small" label={activeRun.status} color={STATUS_COLORS[activeRun.status] ?? 'default'} />
            {canWrite && (
              <Button size="small" color="warning" disabled={isWorking} onClick={() => void cancel(activeRun.id)}>
                Cancel
              </Button>
            )}
          </Stack>
          <RunProgress run={activeRun} />
        </Box>
      )}

      <Typography variant="subtitle1" sx={{ mt: 3 }}>
        Recent migrations
      </Typography>
      {isLoading ? (
        <LinearProgress sx={{ mt: 1 }} />
      ) : runs.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          No migration has run yet.
        </Typography>
      ) : (
        <TableContainer sx={{ mt: 1, overflowX: 'auto' }}>
          <Table size="small" aria-label="Recent storage migrations">
            <TableHead>
              <TableRow>
                <TableCell>Started</TableCell>
                <TableCell>From → To</TableCell>
                <TableCell>Status</TableCell>
                <TableCell align="right">Migrated</TableCell>
                <TableCell align="right">Failed</TableCell>
                <TableCell align="right">Skipped</TableCell>
                <TableCell align="right">Total</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {runs.map((run) => (
                <TableRow key={run.id} data-testid={`storage-migration-run-${run.id}`}>
                  <TableCell>{formatDateTime(run.createdAt, NUMERIC_DATE_TIME)}</TableCell>
                  <TableCell>
                    {run.sourceProvider} → {run.targetProvider}
                  </TableCell>
                  <TableCell>
                    <Chip size="small" label={run.status} color={STATUS_COLORS[run.status] ?? 'default'} />
                    {run.lastError && (
                      <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                        {run.lastError}
                      </Typography>
                    )}
                  </TableCell>
                  <TableCell align="right">{run.migratedCount}</TableCell>
                  <TableCell align="right">{run.failedCount}</TableCell>
                  <TableCell align="right">{run.skippedCount}</TableCell>
                  <TableCell align="right">{run.totalCount}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}
    </Paper>
  );
}
