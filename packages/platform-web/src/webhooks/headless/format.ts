// =============================================================================
// Webhook presentation helpers (issue #1046): status in words, never a colour alone
// =============================================================================

import type { WebhookDeliveryStatus, WebhookEndpoint } from '@marinoscar/platform-contract/webhooks';

/**
 * The tone of a status chip, mapped by the UI onto its theme palette.
 *
 * @stability experimental
 */
export type WebhookStatusTone = 'success' | 'warning' | 'error' | 'info' | 'default';

/**
 * The words for each `disabledReason` the platform sets when it switches an
 * endpoint off. A reason not listed here is shown as "Disabled".
 *
 * @stability experimental
 */
export const WEBHOOK_DISABLED_REASON_LABELS: Readonly<Record<string, string>> = Object.freeze({
  circuit_open: 'Paused after repeated failures',
  owner_lost_access: 'Owner lost access',
  gone: 'Endpoint gone',
});

/**
 * An endpoint's status as the UI shows it.
 *
 * @stability experimental
 */
export interface WebhookEndpointStatus {
  /** The chip text. */
  label: string;
  /** The chip tone. */
  tone: WebhookStatusTone;
  /** A sentence on what to do, when the platform disabled the endpoint. */
  hint: string | null;
}

/**
 * An endpoint's status in words: Active, Disabled (by its owner) or the reason
 * the platform switched it off.
 *
 * @param endpoint - the endpoint's `enabled` and `disabledReason`.
 * @returns the label, tone and hint.
 *
 * @stability experimental
 */
export function webhookEndpointStatus(endpoint: Pick<WebhookEndpoint, 'enabled' | 'disabledReason'>): WebhookEndpointStatus {
  if (endpoint.enabled) return { label: 'Active', tone: 'success', hint: null };
  switch (endpoint.disabledReason) {
    case 'circuit_open':
      return {
        label: WEBHOOK_DISABLED_REASON_LABELS.circuit_open!,
        tone: 'warning',
        hint: 'Deliveries kept failing, so they were paused. Fix the receiver, then enable the endpoint again.',
      };
    case 'owner_lost_access':
      return {
        label: WEBHOOK_DISABLED_REASON_LABELS.owner_lost_access!,
        tone: 'warning',
        hint: 'The owner no longer holds the permission these events need. Enable it again once access is restored.',
      };
    case 'gone':
      return {
        label: WEBHOOK_DISABLED_REASON_LABELS.gone!,
        tone: 'error',
        hint: 'The receiver answered 410 Gone. Point the endpoint at a new URL, then enable it again.',
      };
    default:
      return { label: 'Disabled', tone: 'default', hint: null };
  }
}

/**
 * A delivery's status in words: Queued, Delivering, Delivered, Retrying
 * (`failed`: an attempt failed and another is scheduled) and Failed (`dead`).
 *
 * @param status - the delivery status.
 * @returns the label.
 *
 * @stability experimental
 */
export function webhookDeliveryStatusLabel(status: WebhookDeliveryStatus): string {
  switch (status) {
    case 'pending':
      return 'Queued';
    case 'delivering':
      return 'Delivering';
    case 'succeeded':
      return 'Delivered';
    case 'failed':
      return 'Retrying';
    case 'dead':
      return 'Failed';
  }
}

/**
 * The chip tone of a delivery status.
 *
 * @param status - the delivery status.
 * @returns the tone.
 *
 * @stability experimental
 */
export function webhookDeliveryStatusTone(status: WebhookDeliveryStatus): WebhookStatusTone {
  switch (status) {
    case 'succeeded':
      return 'success';
    case 'failed':
      return 'warning';
    case 'dead':
      return 'error';
    case 'delivering':
      return 'info';
    case 'pending':
      return 'default';
  }
}

/**
 * The host of an endpoint URL (what a list shows; never the path or query).
 *
 * @param url - the endpoint URL.
 * @returns the host with its port, or the input when it does not parse.
 *
 * @stability experimental
 */
export function webhookUrlHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/**
 * Whether a URL uses `https:` (the UI warns otherwise; the API decides).
 *
 * @param url - the typed URL.
 * @returns `true` for an https URL.
 *
 * @stability experimental
 */
export function isHttpsWebhookUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * A duration in milliseconds as short text (`240 ms`, `1.2 s`).
 *
 * @param ms - the duration, or `null`.
 * @returns the text, or an empty string for `null`.
 *
 * @stability experimental
 */
export function formatWebhookDuration(ms: number | null): string {
  if (ms === null) return '';
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)} s`;
}
