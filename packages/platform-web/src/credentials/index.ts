// The credentials slice's entry point for SIBLING SLICES of this package
// (PP-14.5, #923): the boundary lint lets one slice import another only
// through the other's `index.ts`, and only when packages/platform-slices.json
// lists the dependency (email, settings -> credentials). Not a package
// subpath: apps import `@marinoscar/platform-web/credentials/headless` and
// `/credentials/ui`. Narrow on purpose: only what a sibling uses.

export { SecretField } from './ui/secret-field.js';
export type { SecretFieldProps, SecretFieldSlots } from './ui/secret-field.js';
export { savedSecretHelperText, secretForSubmit } from './headless/index.js';
export type { SavedSecretHelperTextOptions, SavedSecretInfo } from './headless/index.js';
