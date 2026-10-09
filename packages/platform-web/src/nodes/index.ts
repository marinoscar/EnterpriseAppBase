// The nodes slice's entry point for SIBLING SLICES of this package (issue
// #881): the boundary lint lets one slice import another only through the
// other's `index.ts`, and only when packages/platform-slices.json lists the
// dependency (jobs -> nodes). Not a package subpath: apps import
// `@marinoscar/platform-web/nodes/headless` and `/nodes/ui`. The jobs slice
// re-exports all of it, so its own entry points keep every name they had
// before the worker-node page moved here.

export * from './headless/index.js';
export { WorkersPage, nodesAdminSections } from './ui/index.js';
export type { NodesPageHeaderProps, NodesSettingsCard, WorkersPageProps } from './ui/index.js';
