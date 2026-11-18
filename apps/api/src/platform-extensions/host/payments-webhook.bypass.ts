import type { MaintenanceBypassDef } from '@marinoscar/platform-api/host';

// =============================================================================
// EXAMPLE: let a webhook through an open maintenance window (PP-14.13)
// =============================================================================
//
// While a window is open the maintenance guard answers 503 on every route that
// is not `@AllowDuringMaintenance()`, except for a verified admin session. A
// payment provider does not retry forever, so its webhook must not be lost to a
// deploy. This predicate admits exactly that one route.
//
// THE CONTRACT IS FAIL-CLOSED. The predicate runs only for a request that would
// otherwise be refused, can only add an allowance, sees a frozen copy of the
// request, and counts anything but `true` (a throw, a timeout, `undefined`) as
// "not bypassed". Passing the window is all it does: the route still has to
// authenticate its caller, and a webhook route verifies the provider's
// signature in its handler. This predicate deliberately does NOT inspect the
// signature itself, because the guard runs before the body is read.
//
// Opt in with `registerHostExamples()` (`app-registrations/host.ts`).
// =============================================================================

/** The webhook route the example lets through. */
export const PAYMENTS_WEBHOOK_PATH = '/api/webhooks/payments';

/** Admits `POST /api/webhooks/payments`, and nothing else. */
export const paymentsWebhookBypass: MaintenanceBypassDef = {
  id: 'payments-webhook',
  allows: (request) => request.method === 'POST' && request.path === PAYMENTS_WEBHOOK_PATH,
};
