// The wire schemas live in `@marinoscar/platform-contract/storage`, with their
// design notes; this file wraps them as Nest DTOs (the OpenAPI component names
// are these class names).

import { createZodDto } from 'nestjs-zod';
import { getPartUrlsResponseSchema, getPartUrlsSchema } from '@marinoscar/platform-contract/storage';

/**
 * `getPartUrlsSchema` (`@marinoscar/platform-contract/storage`) as a Nest DTO: the OpenAPI component and the validated body.
 *
 * @stability experimental
 */
export class GetPartUrlsBodyDto extends createZodDto(getPartUrlsSchema) {}

/**
 * `getPartUrlsResponseSchema` (`@marinoscar/platform-contract/storage`) as a Nest DTO: the OpenAPI component and the response.
 *
 * @stability experimental
 */
export class GetPartUrlsResponseDto extends createZodDto(getPartUrlsResponseSchema) {}
