// =============================================================================
// ExportsList (issue #744): the caller's recent exports
// =============================================================================
//
// One row per export: what, in which format, the status IN WORDS, when, the
// size, and Download while ready. Download asks the API for the export again
// (`GET /api/exports/:id`) to get a FRESH signed URL, because the URL lives
// for a few minutes only and the list never carries one.
// =============================================================================

import { Alert, Box, Button, Chip, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import { useState, type ReactElement } from 'react';

import type { ExportSourceDescriptor, ExportView } from '@marinoscar/platform-contract/exports';

import { exportStatusLabel, formatExportSize } from '../headless/client.js';
import { useExportsClient } from '../headless/hooks.js';

/**
 * Props of {@link ExportsList}.
 *
 * @stability experimental
 */
export interface ExportsListProps {
  /** The exports, newest first (`useExports().exports`). */
  exports: readonly ExportView[];
  /** The sources, to show their labels (`useExportSources().sources`); the id otherwise. */
  sources?: readonly ExportSourceDescriptor[];
  /** Starts a download from a fresh signed URL. Default: navigate to it. */
  onDownload?: (url: string, view: ExportView) => void;
}

const STATUS_COLOR: Record<ExportView['status'], 'default' | 'info' | 'success' | 'warning' | 'error'> = {
  pending: 'default',
  running: 'info',
  ready: 'success',
  expired: 'warning',
  failed: 'error',
};

function defaultDownload(url: string): void {
  window.location.assign(url);
}

/**
 * The list of exports. See the file header.
 *
 * @param props - see {@link ExportsListProps}.
 * @returns the list.
 *
 * @example
 * ```tsx
 * const { exports } = useExports();
 * <ExportsList exports={exports} sources={sources} />
 * ```
 *
 * @extensionPoint component
 * @stability experimental
 */
export function ExportsList(props: ExportsListProps): ReactElement {
  const { exports, sources = [], onDownload = defaultDownload } = props;
  const client = useExportsClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(view: ExportView): Promise<void> {
    setBusy(view.id);
    setError(null);
    try {
      const fresh = await client.get(view.id);
      if (fresh.status === 'ready' && fresh.download) onDownload(fresh.download.url, fresh);
      else setError('This export is no longer available. Start a new one.');
    } catch {
      setError('The download could not be started. Please try again.');
    } finally {
      setBusy(null);
    }
  }

  if (exports.length === 0) {
    return <Typography color="text.secondary">You have not exported anything yet.</Typography>;
  }

  return (
    <Box>
      {error ? (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      ) : null}
      <List aria-label="Your exports" disablePadding>
        {exports.map((view) => {
          const label = sources.find((source) => source.id === view.source)?.label ?? view.source;
          const when = new Date(view.createdAt).toLocaleString();
          const size = formatExportSize(view.sizeBytes);
          return (
            <ListItem key={view.id} divider sx={{ flexWrap: 'wrap', gap: 1, px: 0 }}>
              <ListItemText
                primary={`${label} (${view.format.toUpperCase()})`}
                secondary={[when, size, view.error].filter(Boolean).join(' · ')}
                sx={{ minWidth: 0, flex: '1 1 14rem' }}
              />
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <Chip size="small" label={exportStatusLabel(view.status)} color={STATUS_COLOR[view.status]} variant="outlined" />
                {view.status === 'ready' ? (
                  <Button
                    variant="outlined"
                    size="small"
                    onClick={() => void download(view)}
                    disabled={busy === view.id}
                    aria-label={`Download ${label} (${view.format.toUpperCase()})`}
                    sx={{ minHeight: 44 }}
                  >
                    Download
                  </Button>
                ) : null}
              </Stack>
            </ListItem>
          );
        })}
      </List>
    </Box>
  );
}
