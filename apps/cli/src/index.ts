// =============================================================================
// Public surface of the CLI package  (issue #140, epic #110)
// =============================================================================
//
// Separate from `cli.ts` on purpose. `cli.ts` is the executable: it parses
// argv, writes to stderr and sets an exit code, and importing it should never
// be a way to get at the client. This module is the importable half — the
// pieces #141–#145 build on, and the pieces tests exercise directly.
// =============================================================================

export {
  API_PATH_PREFIX,
  CLI_DISPLAY_NAME,
  CLI_NAME,
  CONFIG_DIR_NAME,
  CONFIG_FILE_NAME,
  ENV_PREFIX,
  envVar,
} from './branding.js';

export { CLI_VERSION } from './package-info.js';

export {
  ApiClient,
  DEFAULT_TIMEOUT_MS,
  buildUrl,
  resolveApiBaseUrl,
  unwrapEnvelope,
} from './api-client.js';
export type {
  ApiClientOptions,
  ApiResponse,
  FetchLike,
  QueryValue,
  RequestOptions,
} from './api-client.js';

export { buildProgram, run } from './program.js';
export type { RunOptions } from './program.js';

// The TTY GATE ONLY — never `startTui`, and never anything else from
// `src/tui/`. Re-exporting the ink app here would put a reconciler on the
// import graph of every consumer of this module, including `program.ts`, which
// is precisely the coupling #145's gate exists to prevent. The gate itself is
// a pure predicate over two streams and an environment, imports neither react
// nor ink, and is the piece worth testing exhaustively — so it is the piece
// exported. Reach the app through `await import('./tui/index.js')`, as
// `program.ts` does.
export { NO_TUI_ENV_VAR, evaluateTuiGate } from './tui/tty.js';
export type { TtyContext, TuiGateDecision, TuiRefusal } from './tui/tty.js';

// The terminal-restore safety net, for the same reason: it is plain Node stream
// handling with no ink import, and "Ctrl-C leaves the terminal usable" is one
// of #145's stated acceptance properties, so it has to be reachable from a test.
export { installTerminalRestore, restoreTerminal } from './tui/terminal.js';
export type { TerminalRestoreContext } from './tui/terminal.js';

// The generic `api` command (#144). The two parsers are exported because they
// are the local-validation half of the command — a bad method, a path without
// a leading slash, a malformed --query — and they are pure functions, so they
// are exercised directly rather than through a spawned process.
export {
  ALLOWED_METHODS,
  BODYLESS_METHODS,
  parseMethod,
  parseQueryPair,
  parseRequestPath,
  registerApiCommand,
} from './commands/api.js';
export type { AllowedMethod } from './commands/api.js';

// Rendering, kept separate from the command so #145's TUI reuses the JSON
// formatter and the colour decision without inheriting the stdout writes.
export { createSpinner, formatJson, formatStatusLine, shouldUseColour } from './output.js';
export type { ColourDecisionInput, FormatJsonOptions } from './output.js';

export { resolveRequestBody } from './request-body.js';
export type { BodyResolutionContext, BodySourceKind, ResolvedBody } from './request-body.js';

export {
  SERVER_URL_ENV_VAR,
  TOKEN_ENV_VAR,
  configDirPath,
  configFilePath,
  deleteConfigFile,
  describeConfig,
  isExpired,
  maskToken,
  readConfigFile,
  requireCredentials,
  resolveConfig,
  saveCredentials,
  writeConfigFile,
} from './config.js';
export type {
  ConfigContext,
  ConfigSource,
  ConfigSummary,
  Credentials,
  ResolvedConfig,
  StoredConfig,
} from './config.js';

export {
  DEVICE_POLL_ERROR_CODES,
  DeviceLoginError,
  MAX_POLL_INTERVAL_SECONDS,
  POLL_MARGIN_MS,
  SLOW_DOWN_INCREMENT_SECONDS,
  UNCLASSIFIED_POLL_POLICY,
  classifyPollFailure,
  pollForDeviceToken,
  pollOnce,
  requestDeviceCode,
} from './device-auth.js';
export type {
  DeviceCodeGrant,
  DeviceCredential,
  DeviceLoginFailureReason,
  DevicePollErrorCode,
  DevicePollSignal,
  DevicePollState,
  PollForTokenOptions,
} from './device-auth.js';

// The reusable half of `login`, which #145's TUI drives directly.
export {
  completeLogin,
  defaultDeviceName,
  runDeviceLogin,
  validateToken,
} from './device-login.js';
export type {
  CompleteLoginInput,
  CompleteLoginResult,
  CurrentUser,
  DeviceLoginHooks,
  DeviceLoginOptions,
  DeviceLoginResult,
} from './device-login.js';

export { openInBrowser } from './browser.js';
export type { BrowserOpenResult } from './browser.js';

export { canPrompt, prompt, promptForServerUrl } from './prompt.js';
export type { PromptContext } from './prompt.js';

export {
  ApiError,
  AuthRequiredError,
  CliError,
  ConfigError,
  EXIT,
  NetworkError,
  UsageError,
  exitCodeFor,
  extractServerMessage,
  formatError,
} from './errors.js';
export type { ApiErrorFields, ExitCode, NetworkFailureKind } from './errors.js';
