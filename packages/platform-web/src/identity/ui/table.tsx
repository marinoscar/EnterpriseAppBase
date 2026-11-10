// The table the identity lists render through (issue #727): the app's table
// from the identity adapters when it handed one in (the reference app's
// responsive `DataTable`), else a plain MUI table with paging, the quick
// search and the row actions. Slice-internal.

import { useState } from 'react';
import type { ReactElement } from 'react';
import {
  Box,
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

import { useIdentityWebAdapters } from '../headless/index.js';
import type { IdentityDataTableProps } from '../headless/index.js';

/** The app's table, or the fallback. */
export function IdentityTable<Row>(props: IdentityDataTableProps<Row>): ReactElement | null {
  const { DataTable } = useIdentityWebAdapters();
  if (DataTable) return <DataTable<Row> {...props} />;
  return <FallbackTable<Row> {...props} />;
}

function FallbackTable<Row>(props: IdentityDataTableProps<Row>): ReactElement {
  const { columns, rows, rowId, loading, emptyState, pagination, quickSearch, rowActions = [] } = props;
  const [search, setSearch] = useState(quickSearch?.value ?? '');
  const visible = columns;
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
              <TableCell key={column.id}>{column.label}</TableCell>
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
                  <TableCell key={column.id}>{column.render ? column.render(row) : column.value?.(row)}</TableCell>
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
                            onClick={() => action.onClick(row)}
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
