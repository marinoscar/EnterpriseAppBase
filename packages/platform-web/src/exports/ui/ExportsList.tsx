// =============================================================================
// ExportsList (issue #744): the caller's recent exports
// =============================================================================
//
// One row per export: what, in which format, the status IN WORDS, when, the
// size, and Download while ready. Download asks the API for the export again
// (`GET /api/exports/:id`) to get a FRESH signed URL, because the URL lives
// for a few minutes only and the list never carries one.
//
// SLOTS (PP-14.20), named as the packaged-page table contract names them:
// `Columns` receives the list's columns and returns the ones to draw, and
// `RowActions` adds controls after Download. A column is placed by its
// `priority` (`primary`: the title; `secondary`: the line under it, joined by
// middots; `detail`: a full-width line below), or `placement: 'trailing'`
// (the right-hand group, before Download). With no slot the list draws the
// base columns, which is exactly the markup it always had.
// =============================================================================

import { Alert, Box, Button, Chip, List, ListItem, ListItemText, Stack, Typography } from '@mui/material';
import { Fragment, useMemo, useState, type ReactElement, type ReactNode } from 'react';

import type { ExportSourceDescriptor, ExportView } from '@marinoscar/platform-contract/exports';

import type { PageSlot, SlotTableColumn, TableSlots } from '../../core/index.js';

import { exportStatusLabel, formatExportSize } from '../headless/client.js';
import { useExportsClient } from '../headless/hooks.js';

/**
 * One column of the exports list: an id, a header (the accessible name of what
 * it draws), its placement and how to draw it for one export.
 *
 * @stability experimental
 */
export interface ExportsListColumn extends SlotTableColumn<ExportView> {
  /** `'trailing'` draws the column in the right-hand group, before Download; otherwise `priority` places it. */
  placement?: 'trailing';
}

/**
 * What the `RowActions` slot receives: the export of the row.
 *
 * @stability experimental
 */
export interface ExportsListRowActionsProps {
  /** The export the controls are drawn for. */
  row: ExportView;
}

/**
 * The slots of {@link ExportsList}: `Columns` and `RowActions` of the
 * packaged-page table contract (`TableSlots`).
 *
 * @extensionPoint slot
 * @stability experimental
 */
export interface ExportsListSlots extends Pick<TableSlots<ExportView, ExportsListColumn>, 'Columns'> {
  /** Extra per-export controls, drawn after Download. Receives the export. */
  RowActions?: PageSlot<ExportsListRowActionsProps>;
}

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
  /** Add columns or per-export actions; see {@link ExportsListSlots}. */
  slots?: ExportsListSlots;
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

/** The list's own columns: the title, the line under it, and the status chip. */
function baseColumns(sources: readonly ExportSourceDescriptor[]): ExportsListColumn[] {
  return [
    {
      id: 'export',
      label: 'Export',
      priority: 'primary',
      render: (view) => `${sources.find((source) => source.id === view.source)?.label ?? view.source} (${view.format.toUpperCase()})`,
    },
    { id: 'created', label: 'Started', priority: 'secondary', render: (view) => new Date(view.createdAt).toLocaleString() },
    { id: 'size', label: 'Size', priority: 'secondary', render: (view) => formatExportSize(view.sizeBytes) },
    { id: 'error', label: 'Error', priority: 'secondary', render: (view) => view.error },
    {
      id: 'status',
      label: 'Status',
      priority: 'secondary',
      placement: 'trailing',
      render: (view) => (
        <Chip size="small" label={exportStatusLabel(view.status)} color={STATUS_COLOR[view.status]} variant="outlined" />
      ),
    },
  ];
}

/** What a column drew for one export, without the empty ones. */
function drawn(columns: readonly ExportsListColumn[], view: ExportView): ReactNode[] {
  return columns
    .map((column) => column.render?.(view))
    .filter((node): node is Exclude<ReactNode, null | undefined | false | ''> => node !== null && node !== undefined && node !== false && node !== '');
}

/** Strings join into one string (the markup the list always had); nodes are separated. */
function joined(parts: readonly ReactNode[], separator: string): ReactNode {
  if (parts.every((part) => typeof part === 'string' || typeof part === 'number')) return parts.join(separator);
  return parts.map((part, index) => (
    <Fragment key={index}>
      {index > 0 ? separator : null}
      {part}
    </Fragment>
  ));
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
  const { exports, sources = [], onDownload = defaultDownload, slots } = props;
  const client = useExportsClient();
  const base = useMemo(() => baseColumns(sources), [sources]);
  const ColumnsSlot = slots?.Columns;
  const columns = useMemo(() => (ColumnsSlot ? ColumnsSlot(base) : base), [base, ColumnsSlot]);
  const RowActions = slots?.RowActions;
  const primaryColumns = columns.filter((column) => column.placement !== 'trailing' && column.priority === 'primary');
  const secondaryColumns = columns.filter((column) => column.placement !== 'trailing' && column.priority === 'secondary');
  const detailColumns = columns.filter((column) => column.placement !== 'trailing' && column.priority === 'detail');
  const trailingColumns = columns.filter((column) => column.placement === 'trailing');
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
          const detail = drawn(detailColumns, view);
          return (
            <ListItem key={view.id} divider sx={{ flexWrap: 'wrap', gap: 1, px: 0 }}>
              <ListItemText
                primary={joined(drawn(primaryColumns, view), ' ')}
                secondary={joined(drawn(secondaryColumns, view), ' · ')}
                sx={{ minWidth: 0, flex: '1 1 14rem' }}
              />
              <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                {trailingColumns.map((column) => (
                  <Fragment key={column.id}>{column.render?.(view)}</Fragment>
                ))}
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
                {RowActions ? <RowActions row={view} /> : null}
              </Stack>
              {detail.length > 0 ? <Box sx={{ flexBasis: '100%', minWidth: 0 }}>{joined(detail, ' · ')}</Box> : null}
            </ListItem>
          );
        })}
      </List>
    </Box>
  );
}
