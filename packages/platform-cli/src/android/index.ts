// `@marinoscar/platform-cli/android`: the Android companion's CLI (issue
// #746, PP-9.4; merged from EvoPath's and MemoriaHub's `apps/cli/src/android`):
// the `android` command group, an optional deploy step and a TUI screen.
// Documented in ./README.md. The building blocks (gradle, java, sdk,
// keystore, version, publish, ...) stay internal to the slice.

export { androidCommand, androidDeployStep, androidTuiScreen, deployAndroidEnvVar } from './registrations.js';
export type { AndroidCommandOptions, AndroidDeployStepOptions } from './registrations.js';
export type { DeployAndroidOptions } from './deploy-step.js';
export type { BumpPart } from './version.js';
export { IDENTITY_JSON_PATH, configureAndroidIdentity, readAndroidIdentity } from './identity.js';
export type { AndroidIdentity, AndroidIdentitySource } from './identity.js';
