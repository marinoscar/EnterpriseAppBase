// A stand-in for the reference app's responsive `DataTable` (issue #738), for
// the broadcasts page suite moved from the app: the page reaches the app's
// table through the identity web adapters, so the package tests hand in this
// double, which honours the same row-action contract the app's table does
// (one "Actions for <row>" menu per row, disabled items as `aria-disabled`,
// and the `confirm` dialog before `onClick`). The table's own mechanics stay
// covered by the app's DataTable conformance suite.

import { useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  IconButton,
  Menu,
  MenuItem,
  Table,
  TableBody,
  TableCell,
  TableRow,
} from '@mui/material';

import { IdentityWebAdaptersProvider } from '../../src/identity/headless/index.js';
import type { IdentityDataTableProps, IdentityTableRowAction } from '../../src/identity/headless/index.js';

function cellOf<Row>(props: IdentityDataTableProps<Row>, row: Row, index: number): ReactNode {
  const column = props.columns[index]!;
  return column.render ? column.render(row) : (column.value?.(row) ?? '');
}

function RowActions<Row>({ row, name, actions }: { row: Row; name: string; actions: IdentityTableRowAction<Row>[] }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [pending, setPending] = useState<IdentityTableRowAction<Row> | null>(null);
  const confirm = pending && typeof pending.confirm === 'object' ? pending.confirm : {};
  const description = typeof confirm.description === 'function' ? confirm.description(row) : confirm.description;
  return (
    <>
      <IconButton aria-label={`Actions for ${name}`} onClick={(event) => setAnchor(event.currentTarget)}>
        ...
      </IconButton>
      <Menu open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)}>
        {actions.map((action) => (
          <MenuItem
            key={action.id}
            disabled={action.disabled?.(row) ?? false}
            onClick={() => {
              setAnchor(null);
              if (action.confirm) setPending(action);
              else action.onClick(row);
            }}
          >
            {action.label}
          </MenuItem>
        ))}
      </Menu>
      <Dialog open={pending !== null} onClose={() => setPending(null)}>
        <DialogTitle>{confirm.title ?? pending?.label}</DialogTitle>
        {description && (
          <DialogContent>
            <DialogContentText>{description}</DialogContentText>
          </DialogContent>
        )}
        <DialogActions>
          <Button onClick={() => setPending(null)}>{confirm.cancelLabel ?? 'Keep'}</Button>
          <Button
            onClick={() => {
              const action = pending;
              setPending(null);
              action?.onClick(row);
            }}
          >
            {confirm.confirmLabel ?? 'Confirm'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

function MenuTable<Row>(props: IdentityDataTableProps<Row>): ReactElement {
  return (
    <Table aria-label={props.ariaLabel} data-testid={props['data-testid']}>
      <TableBody>
        {props.rows.length === 0 && !props.loading ? (
          <TableRow>
            <TableCell>{props.emptyState}</TableCell>
          </TableRow>
        ) : (
          props.rows.map((row) => {
            const name = String(props.columns[0]?.value?.(row) ?? props.rowId(row));
            return (
              <TableRow key={props.rowId(row)}>
                {props.columns.map((column, index) => (
                  <TableCell key={column.id}>{cellOf(props, row, index)}</TableCell>
                ))}
                {props.rowActions && props.rowActions.length > 0 && (
                  <TableCell>
                    <RowActions row={row} name={name} actions={props.rowActions} />
                  </TableCell>
                )}
              </TableRow>
            );
          })
        )}
      </TableBody>
    </Table>
  );
}

/** Wraps a tree in identity adapters whose `DataTable` is {@link MenuTable}. */
export function WithMenuTable({ children }: { children: ReactNode }) {
  return <IdentityWebAdaptersProvider adapters={{ DataTable: MenuTable }}>{children}</IdentityWebAdaptersProvider>;
}
