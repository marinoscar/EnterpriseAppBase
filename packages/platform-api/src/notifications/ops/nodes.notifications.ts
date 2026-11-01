// =============================================================================
// Worker node notifications (issue #678, PP-1.6)
// =============================================================================
//
// Pure data: the notifications this module raises, declared next to the code
// that raises them and registered by
// `notifications/registry/notification.manifest.ts`. No side effect on import,
// no Nest, no settings: the manifest is the one place that registers, so
// "which notifications exist?" stays answerable from one file.
//
// An event key is persisted (in preferences and delivery rows): never rename
// one, add a new key. The definitions moved verbatim from the closed
// `NOTIFICATION_EVENTS` array in notifications/notification-events.ts (#288).
// =============================================================================

import { nodeOfflineBrowserTemplate } from '../channels/browser-templates';
import type { NotificationRegistration } from '../registry/bindings.registry';

/**
 * `nodes.node_offline`, raised to the holders of `nodes:read` when a worker
 * node stops checking in (the `nodes.node.offline` event of the nodes slice).
 *
 * @stability stable
 */
export const NODES_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: 'nodes.node_offline',
      label: 'Worker node went offline',
      description:
        'Sent when a worker node stops heartbeating and the fleet sweep marks it offline. Capacity has dropped until it comes back.',
      // Both channels: lost capacity is worth an immediate in-app row for
      // somebody already looking at the application, and a durable mail for
      // somebody who is not.
      channels: ['email', 'browser'],
      defaultEnabled: true,
    },
    emailTemplate: 'node-offline',
    browserTemplate: nodeOfflineBrowserTemplate,
  },
];
