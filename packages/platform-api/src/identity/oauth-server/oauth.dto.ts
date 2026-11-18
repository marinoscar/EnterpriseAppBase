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
  oauthClientCreateRequestSchema,
  oauthClientPatchRequestSchema,
  oauthClientViewSchema,
  oauthClientWithSecretSchema,
  oauthClientsQuerySchema,
  oauthGrantViewSchema,
  oauthRegistrationRequestSchema,
  oauthRegistrationResponseSchema,
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
/** `POST /api/oauth/register` body (documented only: the endpoint parses it itself). */
export class OAuthRegistrationRequestDto extends createZodDto(oauthRegistrationRequestSchema) {}
/** `POST /api/oauth/register` `201` body. */
export class OAuthRegistrationResponseDto extends createZodDto(oauthRegistrationResponseSchema) {}
/** One client of `GET /api/admin/oauth/clients`. */
export class OAuthClientViewDto extends createZodDto(oauthClientViewSchema) {}
/** Query of `GET /api/admin/oauth/clients`. */
export class OAuthClientsQueryDto extends createZodDto(oauthClientsQuerySchema) {}
/** `POST /api/admin/oauth/clients` body. */
export class OAuthClientCreateRequestDto extends createZodDto(oauthClientCreateRequestSchema) {}
/** `PATCH /api/admin/oauth/clients/:id` body. */
export class OAuthClientPatchRequestDto extends createZodDto(oauthClientPatchRequestSchema) {}
/** A client with its one-time secret (create and rotate). */
export class OAuthClientWithSecretDto extends createZodDto(oauthClientWithSecretSchema) {}
