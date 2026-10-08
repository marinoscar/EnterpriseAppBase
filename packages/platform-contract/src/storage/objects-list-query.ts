import { z } from 'zod';
import type { ObjectResponse } from './objects-object-response.js';
import { STORAGE_OBJECT_STATUSES, type StorageEnum } from './constants.js';

/**
 * The `GET /api/storage/objects` query: page, page size, status filter and sort.
 *
 * @stability experimental
 */
export const objectListQuerySchema = z.object({
  /** The page, 1-based. */
  page: z.coerce.number().int().positive().default(1),
  /** Items per page (at most 100). */
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  /** The status. */
  status: (z.enum(STORAGE_OBJECT_STATUSES) as z.ZodEnum<StorageEnum<typeof STORAGE_OBJECT_STATUSES>>).optional(),
  /** The sort field. */
  sortBy: (z.enum(['createdAt', 'name', 'size']) as z.ZodEnum<StorageEnum<['createdAt', 'name', 'size']>>).default('createdAt'),
  /** The sort direction. */
  sortOrder: (z.enum(['asc', 'desc']) as z.ZodEnum<StorageEnum<['asc', 'desc']>>).default('desc'),
});

/**
 * The list query, parsed (defaults applied).
 *
 * @stability experimental
 */
export type ObjectListQueryDto = z.infer<typeof objectListQuerySchema>;

/**
 * The NESTED list shape — counts live in a `meta` object inside the payload,
 * and the total is named `totalItems`. The flat lists (`GET /api/users`,
 * `GET /api/allowlist`) spell the same concept differently; see
 * `ApiDataResponse` for why that asymmetry is documented rather than hidden.
 *
 * Left as an interface: the controller documents this shape through
 * `@ApiDataResponse(ObjectResponseDto, { pagination: 'nested' })`, which is
 * where the published schema comes from, so a parallel zod schema here would be
 * a second declaration to keep in step for no gain.
 *
 * @stability experimental
 */
export interface ObjectListResponse {
  /** The page's objects. */
  items: ObjectResponse[];
  /** The page's position in the list. */
  meta: {
    /** The page, 1-based. */
    page: number;
    /** Items per page. */
    pageSize: number;
    /** Objects matching the filter, across pages. */
    totalItems: number;
    /** How many pages there are. */
    totalPages: number;
  };
}
