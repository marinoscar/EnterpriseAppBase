// =============================================================================
// /api/admin/webhooks: the deployment's webhook endpoints (issue #1046)
// =============================================================================
//
// Permissions `system_webhooks:read` / `system_webhooks:write`, held by the
// `admin` system role. The same routes as `/api/webhooks`, pinned to the
// deployment's own endpoints (scope `system`, no organization): the ones that
// receive platform events such as a worker node going offline or a job failing
// for good.
// =============================================================================
//
// Permissions `webhooks:read` / `webhooks:write`, held by every organization
// role: a member manages the endpoints THEY own in the active organization.
// The service pins every query to the caller, so another member's endpoint or
// delivery answers 404, never 403. The organization and system tiers are the
// same routes under `/api/org/webhooks` and `/api/admin/webhooks`.
// =============================================================================

import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBody, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  WEBHOOK_PERMISSIONS,
  type CreateWebhookEndpoint,
  type RotateWebhookSecretResponse,
  type UpdateWebhookEndpoint,
  type WebhookDeliveryDetail,
  type WebhookDeliveryList,
  type WebhookDeliveryListQuery,
  type WebhookEndpoint,
  type WebhookEndpointCreated,
  type WebhookEndpointList,
  type WebhookEventCatalog,
  type WebhookTestResponse,
} from '@marinoscar/platform-contract/webhooks';

import { ApiDataResponse } from '../../core/index';
import type { Principal } from '../../core/index';
import { Auth, CurrentPrincipal } from '../../identity/index';
import { WebhookEndpointsService } from '../webhook-endpoints.service';
import { webhookScopeContext } from './scope-context';
import {
  CreateWebhookEndpointDto,
  RotateWebhookSecretResponseDto,
  UpdateWebhookEndpointDto,
  WebhookDeliveryDetailDto,
  WebhookDeliveryListDto,
  WebhookDeliveryListQueryDto,
  WebhookEndpointCreatedDto,
  WebhookEndpointDto,
  WebhookEndpointListDto,
  WebhookEventCatalogDto,
  WebhookTestResponseDto,
} from './webhook.dto';

const READ = WEBHOOK_PERMISSIONS.SYSTEM_READ;
const WRITE = WEBHOOK_PERMISSIONS.SYSTEM_WRITE;

/**
 * The deployment-scope webhook routes. See the file header.
 *
 * @stability experimental
 */
@ApiTags('Webhooks')
@Controller('admin/webhooks')
export class AdminWebhooksController {
  constructor(private readonly endpoints: WebhookEndpointsService) {}

  /** The events the caller may subscribe to. */
  @Get('events')
  @Auth({ permissions: [READ] })
  @ApiOperation({ summary: 'List the events a webhook endpoint can subscribe to', description: 'Each with its JSON Schema and an example. Notifications appear as `notification.<eventKey>`.' })
  @ApiDataResponse(WebhookEventCatalogDto, { description: 'The catalog.' })
  events(@CurrentPrincipal() principal: Principal | undefined): WebhookEventCatalog {
    return { items: this.endpoints.catalog(webhookScopeContext(principal, 'system')) };
  }

  /** One delivery, with its payload. */
  @Get('deliveries/:deliveryId')
  @Auth({ permissions: [READ] })
  @ApiOperation({ summary: 'Get one webhook delivery', description: 'The payload that was sent and the request headers that are stable across attempts (the signature is never shown). 404 unless it belongs to one of the deployment endpoints.' })
  @ApiParam({ name: 'deliveryId', type: String, format: 'uuid' })
  @ApiDataResponse(WebhookDeliveryDetailDto, { description: 'The delivery.' })
  @ApiResponse({ status: 404, description: 'Delivery not found' })
  getDelivery(@CurrentPrincipal() principal: Principal | undefined, @Param('deliveryId', ParseUUIDPipe) deliveryId: string): Promise<WebhookDeliveryDetail> {
    return this.endpoints.getDelivery(webhookScopeContext(principal, 'system'), deliveryId);
  }

  /** Sends a delivery again. */
  @Post('deliveries/:deliveryId/redeliver')
  @Auth({ permissions: [WRITE] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Redeliver a webhook delivery', description: 'Puts the same delivery back to `pending` with a fresh attempt count; the event id (`webhook-id`) is unchanged. 409 while the endpoint is disabled.' })
  @ApiParam({ name: 'deliveryId', type: String, format: 'uuid' })
  @ApiDataResponse(WebhookDeliveryDetailDto, { status: 202, description: 'Queued.' })
  @ApiResponse({ status: 404, description: 'Delivery not found' })
  @ApiResponse({ status: 409, description: 'The endpoint is disabled' })
  redeliver(@CurrentPrincipal() principal: Principal | undefined, @Param('deliveryId', ParseUUIDPipe) deliveryId: string): Promise<WebhookDeliveryDetail> {
    return this.endpoints.redeliver(webhookScopeContext(principal, 'system'), deliveryId);
  }

  /** The caller's endpoints. */
  @Get()
  @Auth({ permissions: [READ] })
  @ApiOperation({ summary: 'List the deployment webhook endpoints', description: 'The deployment endpoints, newest first. The signing secret is never part of a list.' })
  @ApiDataResponse(WebhookEndpointListDto, { description: 'The endpoints.' })
  async list(@CurrentPrincipal() principal: Principal | undefined): Promise<WebhookEndpointList> {
    return { items: await this.endpoints.list(webhookScopeContext(principal, 'system')) };
  }

  /** Creates an endpoint. */
  @Post()
  @Auth({ permissions: [WRITE] })
  @ApiOperation({ summary: 'Create a webhook endpoint', description: 'Returns the endpoint and its signing secret ONCE (`whsec_...`); store it, it is never shown again. 422 `WEBHOOK_URL_FORBIDDEN` for a URL the server will not call (private address, non-https, userinfo, a low port), `WEBHOOK_EVENT_UNKNOWN`, `WEBHOOK_EVENT_NOT_PERMITTED` or `WEBHOOK_LIMIT_REACHED`.' })
  @ApiBody({ type: CreateWebhookEndpointDto })
  @ApiDataResponse(WebhookEndpointCreatedDto, { status: 201, description: 'Created.' })
  @ApiResponse({ status: 422, description: 'A forbidden URL, an unknown or not-permitted event, or the endpoint limit' })
  create(@CurrentPrincipal() principal: Principal | undefined, @Body() body: CreateWebhookEndpointDto): Promise<WebhookEndpointCreated> {
    return this.endpoints.create(webhookScopeContext(principal, 'system'), body as unknown as CreateWebhookEndpoint);
  }

  /** One endpoint. */
  @Get(':id')
  @Auth({ permissions: [READ] })
  @ApiOperation({ summary: 'Get one webhook endpoint', description: '404 unless it is one of the deployment endpoints.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiDataResponse(WebhookEndpointDto, { description: 'The endpoint.' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  get(@CurrentPrincipal() principal: Principal | undefined, @Param('id', ParseUUIDPipe) id: string): Promise<WebhookEndpoint> {
    return this.endpoints.get(webhookScopeContext(principal, 'system'), id);
  }

  /** Changes an endpoint. */
  @Patch(':id')
  @Auth({ permissions: [WRITE] })
  @ApiOperation({ summary: 'Change a webhook endpoint', description: 'Enabling a disabled endpoint resets its failure count.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiBody({ type: UpdateWebhookEndpointDto })
  @ApiDataResponse(WebhookEndpointDto, { description: 'The endpoint.' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  @ApiResponse({ status: 422, description: 'A forbidden URL or an unknown or not-permitted event' })
  update(@CurrentPrincipal() principal: Principal | undefined, @Param('id', ParseUUIDPipe) id: string, @Body() body: UpdateWebhookEndpointDto): Promise<WebhookEndpoint> {
    return this.endpoints.update(webhookScopeContext(principal, 'system'), id, body as unknown as UpdateWebhookEndpoint);
  }

  /** Deletes an endpoint. */
  @Delete(':id')
  @Auth({ permissions: [WRITE] })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete a webhook endpoint', description: 'Also deletes its deliveries and its stored signing secrets.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiResponse({ status: 204, description: 'Deleted.' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  remove(@CurrentPrincipal() principal: Principal | undefined, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    return this.endpoints.remove(webhookScopeContext(principal, 'system'), id);
  }

  /** Rotates the signing secret. */
  @Post(':id/rotate-secret')
  @Auth({ permissions: [WRITE] })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the signing secret', description: 'Returns the new secret ONCE. The previous secret keeps signing alongside it until `previousSecretValidUntil` (24 hours by default), so a delivery carries two signatures meanwhile.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiDataResponse(RotateWebhookSecretResponseDto, { description: 'The new secret.' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  rotate(@CurrentPrincipal() principal: Principal | undefined, @Param('id', ParseUUIDPipe) id: string): Promise<RotateWebhookSecretResponse> {
    return this.endpoints.rotateSecret(webhookScopeContext(principal, 'system'), id);
  }

  /** Queues a test ping. */
  @Post(':id/test')
  @Auth({ permissions: [WRITE] })
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Send a test ping', description: 'Queues a `webhooks.ping` delivery; follow it in the delivery list.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiDataResponse(WebhookTestResponseDto, { status: 202, description: 'Queued.' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  test(@CurrentPrincipal() principal: Principal | undefined, @Param('id', ParseUUIDPipe) id: string): Promise<WebhookTestResponse> {
    return this.endpoints.test(webhookScopeContext(principal, 'system'), id);
  }

  /** An endpoint's deliveries. */
  @Get(':id/deliveries')
  @Auth({ permissions: [READ] })
  @ApiOperation({ summary: "List an endpoint's deliveries", description: 'Newest first, filterable by `status` and `eventKey`.' })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiDataResponse(WebhookDeliveryListDto, { description: 'A page of deliveries.' })
  @ApiResponse({ status: 404, description: 'Endpoint not found' })
  deliveries(@CurrentPrincipal() principal: Principal | undefined, @Param('id', ParseUUIDPipe) id: string, @Query() query: WebhookDeliveryListQueryDto): Promise<WebhookDeliveryList> {
    return this.endpoints.listDeliveries(webhookScopeContext(principal, 'system'), id, query as unknown as WebhookDeliveryListQuery);
  }
}
