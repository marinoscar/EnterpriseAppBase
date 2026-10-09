// The table the node lists render through (issue #881): the app's table from
// the nodes adapters when it handed one in (the reference app's responsive
// `DataTable`), else a plain MUI table with paging and the row actions (the
// identity slice's fallback is the model). The fallback offers no filter menu:
// a `filterOnly` column is skipped, and the page's filters still apply through
// the query. Slice-internal.

import { useState } from 'react';
import type { ReactElement } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TablePagination,
  TableRow,
  TextField,
  Tooltip,
} from '@mui/material';

import { useNodesWebAdapters } from '../headless/index.js';
import type { NodesDataTableProps, NodesTableRowAction } from '../headless/index.js';

/** The app's table, or the fallback. */
export function NodesTable<Row>(props: NodesDataTableProps<Row>): ReactElement | null {
  const { DataTable } = useNodesWebAdapters();
  if (DataTable) return <DataTable<Row> {...props} />;
  return <FallbackTable<Row> {...props} />;
}

function FallbackTable<Row>(props: NodesDataTableProps<Row>): ReactElement {
  const { columns, rows, rowId, loading, emptyState, pagination, quickSearch, rowActions = [] } = props;
  const [search, setSearch] = useState(quickSearch?.value ?? '');
  const visible = columns.filter((column) => !column.filterOnly);
  // A destructive action that asks first (deleting a job, revoking a
  // credential) still asks in the fallback.
  const [pending, setPending] = useState<{ action: NodesTableRowAction<Row>; row: Row } | null>(null);
  const confirm = pending && typeof pending.action.confirm === 'object' ? pending.action.confirm : undefined;
  const rawDescription = confirm?.description;
  let description: string | undefined;
  if (typeof rawDescription === 'function') description = pending ? rawDescription(pending.row) : undefined;
  else description = rawDescription;
  const run = (action: NodesTableRowAction<Row>, row: Row) => {
    if (action.confirm) setPending({ action, row });
    else action.onClick(row);
  };
  return (
    <Box data-testid={props['data-testid']}>
      {quickSearch && (
        <TextField
          size="small"
          value={search}
          placeholder={quickSearch.placeholder}
          slotProps={{ htmlInput: { 'aria-label': quickSearch.ariaLabel ?? quickSearch.placeholder } }}
          onChange={(event) => {
            setSearch(event.target.value);
            quickSearch.onChange(event.target.value);
          }}
          sx={{ mb: 2 }}
        />
      )}
      <Table size="small" aria-label={props.ariaLabel} aria-busy={loading || undefined}>
        <TableHead>
          <TableRow>
            {visible.map((column) => (
              <TableCell key={column.id} align={column.align}>
                {column.label}
              </TableCell>
            ))}
            {rowActions.length > 0 && <TableCell aria-label="Actions" />}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.length === 0 && !loading ? (
            <TableRow>
              <TableCell colSpan={visible.length + (rowActions.length > 0 ? 1 : 0)}>{emptyState}</TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow key={rowId(row)}>
                {visible.map((column) => (
                  <TableCell key={column.id} align={column.align}>
                    {column.render ? column.render(row) : column.value?.(row)}
                  </TableCell>
                ))}
                {rowActions.length > 0 && (
                  <TableCell align="right">
                    {rowActions.map((action) => (
                      <Tooltip key={action.id} title={action.label}>
                        <span>
                          <IconButton
                            size="small"
                            aria-label={action.label}
                            disabled={action.disabled?.(row) ?? false}
                            onClick={() => run(action, row)}
                          >
                            {action.icon ?? action.label}
                          </IconButton>
                        </span>
                      </Tooltip>
                    ))}
                  </TableCell>
                )}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
      <Dialog open={pending !== null} onClose={() => setPending(null)}>
        <DialogTitle>{confirm?.title ?? pending?.action.label}</DialogTitle>
        {description && (
          <DialogContent>
            <DialogContentText>{description}</DialogContentText>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setPending(null)}>{confirm?.cancelLabel ?? 'Cancel'}</Button>
          <Button
            color={pending?.action.destructive ? 'error' : 'primary'}
            variant="contained"
            onClick={() => {
              if (pending) pending.action.onClick(pending.row);
              setPending(null);
            }}
          >
            {confirm?.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
      {pagination && (
        <TablePagination
          component="div"
          count={pagination.total}
          page={pagination.page}
          rowsPerPage={pagination.pageSize}
          rowsPerPageOptions={pagination.pageSizeOptions ?? [pagination.pageSize]}
          onPageChange={(_, page) => pagination.onPaginationChange({ page, pageSize: pagination.pageSize })}
          onRowsPerPageChange={(event) =>
            pagination.onPaginationChange({ page: 0, pageSize: Number(event.target.value) })
          }
        />
      )}
    </Box>
  );
}
