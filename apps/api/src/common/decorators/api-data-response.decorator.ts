// `@ApiDataResponse` lives in `@marinoscar/platform-api/core` since #727, so
// packaged controllers document the `{ data: … }` envelope exactly as the app's
// do. Re-exported here so the app's imports are unchanged.
export { ApiDataResponse } from '@marinoscar/platform-api/core';
export type { ApiDataResponseOptions, DataResponsePagination } from '@marinoscar/platform-api/core';
