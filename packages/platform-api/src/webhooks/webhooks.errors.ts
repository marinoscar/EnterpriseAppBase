// =============================================================================
// The webhooks slice's errors (issue #1046)
// =============================================================================
//
// Each is an `HttpException` carrying one of the contract's
// `WEBHOOK_ERROR_CODES`. The filter publishes a payload `code` only when it is
// registered for the response's own status, so `registerWebhookErrorCodes()`
// (called by `WebhooksModule.forRoot()`) registers them. A not-found error is a
// 404 for "does not exist" AND "is not yours": the id is never an oracle.
// =============================================================================

import { HttpException, HttpStatus, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { WEBHOOK_ERROR_CODES, type WebhookErrorCode } from '@marinoscar/platform-contract/webhooks';

import { errorCodeRegistry, registerErrorCode } from '../core/index';

const CODES: ReadonlyArray<{ code: WebhookErrorCode; status: number; description: string }> = [
  { code: WEBHOOK_ERROR_CODES.WEBHOOK_NOT_FOUND, status: 404, description: 'The webhook endpoint does not exist, or is not visible to the caller.' },
  { code: WEBHOOK_ERROR_CODES.WEBHOOK_DELIVERY_NOT_FOUND, status: 404, description: 'The webhook delivery does not exist, or is not visible to the caller.' },
  { code: WEBHOOK_ERROR_CODES.WEBHOOK_URL_INVALID, status: 422, description: 'The webhook URL is not a valid URL.' },
  { code: WEBHOOK_ERROR_CODES.WEBHOOK_URL_FORBIDDEN, status: 422, description: 'The webhook URL targets a scheme, port or address the server will not call.' },
  { code: WEBHOOK_ERROR_CODES.WEBHOOK_EVENT_UNKNOWN, status: 422, description: 'A subscription names no event an endpoint of this kind can receive.' },
  { code: WEBHOOK_ERROR_CODES.WEBHOOK_EVENT_NOT_PERMITTED, status: 422, description: 'The caller may not subscribe to a requested event.' },
  { code: WEBHOOK_ERROR_CODES.WEBHOOK_LIMIT_REACHED, status: 422, description: 'The owner already has the most webhook endpoints allowed.' },
];

/**
 * Registers the slice's error codes with the filter. Idempotent.
 *
 * @stability experimental
 */
export function registerWebhookErrorCodes(): void {
  for (const def of CODES) if (!errorCodeRegistry.has(def.code)) registerErrorCode(def);
}

/** The endpoint is not there, or not the caller's. @stability experimental */
export class WebhookNotFoundError extends NotFoundException {
  constructor() {
    super({ statusCode: 404, code: WEBHOOK_ERROR_CODES.WEBHOOK_NOT_FOUND, message: 'Webhook endpoint not found' });
  }
}

/** The delivery is not there, or not the caller's. @stability experimental */
export class WebhookDeliveryNotFoundError extends NotFoundException {
  constructor() {
    super({ statusCode: 404, code: WEBHOOK_ERROR_CODES.WEBHOOK_DELIVERY_NOT_FOUND, message: 'Webhook delivery not found' });
  }
}

/** A 422 with one of the slice's codes. @stability experimental */
export class WebhookRequestError extends UnprocessableEntityException {
  constructor(code: WebhookErrorCode, message: string) {
    super({ statusCode: 422, code, message });
  }
}

/** The endpoint is switched off and the action needs it on. @stability experimental */
export class WebhookDisabledError extends HttpException {
  constructor() {
    super({ statusCode: 409, message: 'The endpoint is disabled. Enable it first.' }, HttpStatus.CONFLICT);
  }
}
