// `@marinoscar/platform-web/nodes/ui`: the nodes slice's page (issue #881): the
// Worker Nodes admin page (fleet table, vitals dialog and the credential
// section) with its header slot, and the admin registry entry as data. Built on
// `/nodes/headless`. Documented in ../README.md. Explicit named exports only.

export { WorkersPage } from './WorkersPage.js';
export type { WorkersPageProps } from './WorkersPage.js';
export type { NodesPageHeaderProps } from './PageHeader.js';
export { NodeCredentials } from './NodeCredentials.js';
export type { NodeCredentialsProps } from './NodeCredentials.js';
export { nodesAdminSections } from './settings.js';
export type { NodesSettingsCard } from './settings.js';
