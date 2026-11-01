// The webhooks UI's copy (issue #1046), in one place so a fork rewords it once.
// The card text and the page heading are the same words, per scope.

import type { WebhookScope } from '@marinoscar/platform-contract/webhooks';

/**
 * The title, description and route of the webhooks page of each scope: the
 * registry card's text and the page's heading.
 *
 * @stability experimental
 */
export const WEBHOOKS_PAGE_COPY: Readonly<
  Record<
    WebhookScope,
    {
      /** The card title and the page heading. */
      readonly title: string;
      /** The card text and the page lead. */
      readonly description: string;
      /** The route of the page. */
      readonly path: string;
    }
  >
> =
  Object.freeze({
    user: Object.freeze({
      title: 'Webhooks',
      description: 'Send events about your own activity to HTTPS endpoints you control, signed so the receiver can verify them.',
      path: '/settings/webhooks',
    }),
    org: Object.freeze({
      title: 'Organization webhooks',
      description: "Send your current organization's events to HTTPS endpoints its administrators manage, signed so the receiver can verify them.",
      path: '/admin/settings/organization-webhooks',
    }),
    system: Object.freeze({
      title: 'Webhooks',
      description: "Send this deployment's operational events (offline nodes, failed jobs) to HTTPS endpoints, signed so the receiver can verify them.",
      path: '/admin/settings/webhooks',
    }),
  });

/**
 * The rotation overlap the confirm dialog promises, in hours (the API's
 * default `rotationOverlapHours`). The dialog after rotating shows the exact
 * time the API returned.
 *
 * @stability experimental
 */
export const WEBHOOK_ROTATION_OVERLAP_HOURS = 24;
