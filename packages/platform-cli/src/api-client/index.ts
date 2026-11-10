// `@marinoscar/platform-cli/api-client`: the CLI's HTTP client for the
// platform API (#715): base-URL resolution, the response envelope and the
// errors a failed call throws.
export {
  ApiClient,
  ApiError,
  AuthRequiredError,
  DEFAULT_TIMEOUT_MS,
  NetworkError,
  buildUrl,
  resolveApiBaseUrl,
  unwrapEnvelope,
} from '../engine/index.js';
export type {
  ApiClientOptions,
  ApiErrorFields,
  ApiResponse,
  FetchLike,
  NetworkFailureKind,
  QueryValue,
  RequestOptions,
} from '../engine/index.js';
