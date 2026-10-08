import { createZodDto } from 'nestjs-zod';
import {
  createGrantSchema,
  grantListQuerySchema,
  grantListSchema,
  grantSchema,
  sharedWithMeListSchema,
  sharedWithMeQuerySchema,
  updateGrantSchema,
} from '@marinoscar/platform-contract/sharing';

// =============================================================================
// The grant routes' request and response DTOs (issue #729, PP-7.2)
// =============================================================================
//
// The schemas live in `@marinoscar/platform-contract/sharing`; this file wraps
// them as nestjs-zod DTOs: the global `ZodValidationPipe` parses every body
// and query with them, and the OpenAPI document is generated from them.
// =============================================================================

/**
 * `GET /api/grants` query.
 *
 * @stability experimental
 */
export class GrantListQueryDto extends createZodDto(grantListQuerySchema) {}
/**
 * `POST /api/grants` body.
 *
 * @stability experimental
 */
export class CreateGrantDto extends createZodDto(createGrantSchema) {}
/**
 * `PATCH /api/grants/:id` body.
 *
 * @stability experimental
 */
export class UpdateGrantDto extends createZodDto(updateGrantSchema) {}
/**
 * One grant.
 *
 * @stability experimental
 */
export class GrantResponseDto extends createZodDto(grantSchema) {}
/**
 * A page of grants.
 *
 * @stability experimental
 */
export class GrantListResponseDto extends createZodDto(grantListSchema) {}
/**
 * `GET /api/grants/shared-with-me` query.
 *
 * @stability experimental
 */
export class SharedWithMeQueryDto extends createZodDto(sharedWithMeQuerySchema) {}
/**
 * A page of records shared with the caller.
 *
 * @stability experimental
 */
export class SharedWithMeListResponseDto extends createZodDto(sharedWithMeListSchema) {}
