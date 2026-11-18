// The OAuth server's DTO classes: nestjs-zod wrappers of the contract's schemas
// (`@marinoscar/platform-contract/identity`), so the OpenAPI document is generated
// from them. Only the platform routes validate through the global pipe; the
// protocol endpoints parse their own input (they must answer RFC errors).

import { createZodDto } from 'nestjs-zod';
import {
  oauthConsentRequestSchema,
  oauthDecisionRequestSchema,
  oauthDecisionResponseSchema,
  oauthErrorResponseSchema,
  oauthGrantViewSchema,
  oauthTokenRequestSchema,
  oauthTokenResponseSchema,
} from '@marinoscar/platform-contract/identity';

/** `POST /api/oauth/requests/:id/decision` body. */
export class OAuthDecisionRequestDto extends createZodDto(oauthDecisionRequestSchema) {}
/** `GET /api/oauth/requests/:id` response. */
export class OAuthConsentRequestDto extends createZodDto(oauthConsentRequestSchema) {}
/** `POST /api/oauth/requests/:id/decision` response. */
export class OAuthDecisionResponseDto extends createZodDto(oauthDecisionResponseSchema) {}
/** One entry of `GET /api/oauth/grants`. */
export class OAuthGrantViewDto extends createZodDto(oauthGrantViewSchema) {}
/** The token endpoint's form (documented only: the endpoint parses it itself). */
export class OAuthTokenRequestDto extends createZodDto(oauthTokenRequestSchema) {}
/** The token endpoint's success body. */
export class OAuthTokenResponseDto extends createZodDto(oauthTokenResponseSchema) {}
/** A protocol error body. */
export class OAuthErrorResponseDto extends createZodDto(oauthErrorResponseSchema) {}
