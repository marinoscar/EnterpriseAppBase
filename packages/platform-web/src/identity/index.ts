// The identity slice's entry point for SIBLING SLICES of this package (issue
// #738): the boundary lint lets one slice import another only through the
// other's `index.ts`, and only when packages/platform-slices.json lists the
// dependency (notifications -> identity). Not a package subpath: apps import
// `@marinoscar/platform-web/identity/headless` and `/identity/ui`. Narrow on
// purpose: only what a sibling uses.

export { useAuth, usePermissions } from './headless/index.js';
export type {
  IdentityDataTableProps,
  IdentityTableColumn,
  IdentityTableFilter,
  IdentityTableRowAction,
} from './headless/index.js';
// The table seam: the app's DataTable from the identity adapters, else the
// plain MUI fallback.
export { IdentityTable } from './ui/table.js';
