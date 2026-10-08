// The wire schema lives in `@marinoscar/platform-contract/storage` (#736).

import type { ObjectListResponse } from '@marinoscar/platform-contract/storage';

export { objectListQuerySchema } from '@marinoscar/platform-contract/storage';
export type { ObjectListQueryDto } from '@marinoscar/platform-contract/storage';

/**
 * The NESTED list shape of `GET /api/storage/objects`: counts live in a
 * `meta` object inside the payload, and the total is named `totalItems`.
 * Documented through `@ApiDataResponse(ObjectResponseDto, { pagination:
 * 'nested' })`.
 *
 * @internal
 *
 * @stability experimental
 */
export type ObjectListResponseDto = ObjectListResponse;
