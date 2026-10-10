/**
 * The npm name of this package, which holds the platform's CLI: its commands,
 * TUI, deploy pipeline and worker-node engine.
 *
 * @stability experimental
 */
export const PLATFORM_PACKAGE = '@marinoscar/platform-cli' as const;

// `@marinoscar/platform-cli`: build an app's CLI (#715). The app's
// `src/cli.ts` calls `createCli({ identity, version, ... })` and runs it.
export {
  API_PATH_PREFIX,
  EXIT,
  PLATFORM_CLI_VERSION,
  cliDisplayName,
  cliIdentity,
  cliName,
  cliVersion,
  configDirName,
  configFileName,
  createCli,
  envPrefix,
  envVar,
  exitCodeFor,
  formatError,
  hasCliIdentity,
  resolveCliIdentity,
  run,
  setCliIdentity,
  toEnvPrefix,
  versionText,
} from './engine/index.js';
export type {
  CliIdentity,
  CliInstance,
  CreateCliOptions,
  ExitCode,
  ResolvedCliIdentity,
  RunOptions,
  TtyContext,
  TtyLike,
} from './engine/index.js';
