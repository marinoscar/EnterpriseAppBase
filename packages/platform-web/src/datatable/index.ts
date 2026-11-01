// The datatable slice's entry point for SIBLING SLICES of this package (issue
// #899): the boundary lint lets one slice import another only through the
// other's `index.ts`, and only when packages/platform-slices.json lists the
// dependency (ai -> datatable). Not a package subpath: apps import
// `@marinoscar/platform-web/datatable/headless` and `/datatable/ui`. Narrow on
// purpose: only what a sibling uses (the table and the types of its columns
// and row actions).

export { DataTable } from './ui/index.js';
export type { DataTableColumn, DataTableRowAction } from './headless/index.js';
