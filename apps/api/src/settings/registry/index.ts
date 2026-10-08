// The reference app's settings composition (issues #677, #733). The
// registries, the compose functions and the services are
// `@marinoscar/platform-api/settings`; this folder holds what the app decides:
// its manifests (which namespaces, in which order) and the import-time
// snapshot of what they compose to. Recipe: the slice README
// (packages/platform-api/src/settings/README.md).
//
// Importing this barrel fills the registries (through `composed.ts`, which
// imports the manifests). Declaration files must NOT import it: they import
// the types they need from `@marinoscar/platform-api/settings`, so they stay
// leaves (see the import-cycle rule in `composed.ts`).

export * from './composed';
