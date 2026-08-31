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

export {
  ApiError,
  CliError,
  EXIT,
  NetworkError,
  UsageError,
  exitCodeFor,
  extractServerMessage,
  formatError,
} from './errors.js';
export type { ApiErrorFields, ExitCode, NetworkFailureKind } from './errors.js';
