// =============================================================================
// The webhook routes' DTOs (issue #1046)
// =============================================================================
//
// Zod-backed classes over the contract's schemas, shared by the three
// controllers: `createZodDto` gives the global `ZodValidationPipe` its schema
// and OpenAPI its model.
// =============================================================================

import {
  createWebhookEndpointSchema,
  rotateWebhookSecretResponseSchema,
  updateWebhookEndpointSchema,
  webhookDeliveryDetailSchema,
  webhookDeliveryListQuerySchema,
  webhookDeliveryListSchema,
  webhookEndpointCreatedSchema,
  webhookEndpointListSchema,
  webhookEndpointSchema,
  webhookEventCatalogSchema,
  webhookTestResponseSchema,
} from '@marinoscar/platform-contract/webhooks';
import { createZodDto } from 'nestjs-zod';

/** `POST` body of an endpoint. @stability experimental */
export class CreateWebhookEndpointDto extends createZodDto(createWebhookEndpointSchema) {}
/** `PATCH` body of an endpoint. @stability experimental */
export class UpdateWebhookEndpointDto extends createZodDto(updateWebhookEndpointSchema) {}
/** One endpoint (no secret). @stability experimental */
export class WebhookEndpointDto extends createZodDto(webhookEndpointSchema) {}
/** The endpoints list. @stability experimental */
export class WebhookEndpointListDto extends createZodDto(webhookEndpointListSchema) {}
/** An endpoint with its signing secret, shown once. @stability experimental */
export class WebhookEndpointCreatedDto extends createZodDto(webhookEndpointCreatedSchema) {}
/** A new signing secret, shown once. @stability experimental */
export class RotateWebhookSecretResponseDto extends createZodDto(rotateWebhookSecretResponseSchema) {}
/** The query of a delivery list. @stability experimental */
export class WebhookDeliveryListQueryDto extends createZodDto(webhookDeliveryListQuerySchema) {}
/** A page of deliveries. @stability experimental */
export class WebhookDeliveryListDto extends createZodDto(webhookDeliveryListSchema) {}
/** One delivery with its payload. @stability experimental */
export class WebhookDeliveryDetailDto extends createZodDto(webhookDeliveryDetailSchema) {}
/** The answer to a test. @stability experimental */
export class WebhookTestResponseDto extends createZodDto(webhookTestResponseSchema) {}
/** The event catalog. @stability experimental */
export class WebhookEventCatalogDto extends createZodDto(webhookEventCatalogSchema) {}
