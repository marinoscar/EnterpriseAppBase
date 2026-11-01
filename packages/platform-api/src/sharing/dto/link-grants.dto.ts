import { createZodDto } from 'nestjs-zod';
import {
  grantListQuerySchema,
  issuedLinkGrantSchema,
  linkGrantCreateSchema,
  linkGrantListSchema,
  publicLinkResolutionSchema,
} from '@marinoscar/platform-contract/sharing';

// =============================================================================
// The link routes' request and response DTOs (issue #730, PP-7.3)
// =============================================================================
//
// The schemas live in `@marinoscar/platform-contract/sharing`; this file wraps
// them as nestjs-zod DTOs (validation and the generated OpenAPI document).
// =============================================================================

/**
 * `POST /api/grants/links` body.
 *
 * @stability experimental
 */
export class CreateLinkGrantDto extends createZodDto(linkGrantCreateSchema) {}
/**
 * `POST /api/grants/links` response: the link, its URL and its token (once).
 *
 * @stability experimental
 */
export class IssuedLinkGrantResponseDto extends createZodDto(issuedLinkGrantSchema) {}
/**
 * `GET /api/grants/links` query.
 *
 * @stability experimental
 */
export class LinkGrantListQueryDto extends createZodDto(grantListQuerySchema) {}
/**
 * A page of link grants.
 *
 * @stability experimental
 */
export class LinkGrantListResponseDto extends createZodDto(linkGrantListSchema) {}
/**
 * `GET /api/public/links/current` response.
 *
 * @stability experimental
 */
export class PublicLinkResolutionResponseDto extends createZodDto(publicLinkResolutionSchema) {}
