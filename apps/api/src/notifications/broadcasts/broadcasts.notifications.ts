// =============================================================================
// Admin broadcast notifications (issue #678, PP-1.6)
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
// `NOTIFICATION_EVENTS` array in notifications/notification-events.ts (#321).
// =============================================================================

import { broadcastBrowserTemplate } from '../channels/browser-templates';
import type { NotificationRegistration } from '../registry/bindings.registry';

// ===========================================================================
// ADMIN BROADCASTS (#321, epic #319) — TWO KEYS, AND WHY NOT ONE
// ===========================================================================
//
// The obvious alternative is a single `admin.broadcast` event whose composer
// sets an "important" flag per send. It was rejected, and the reason is
// structural rather than stylistic.
//
// `mandatory` is a STATIC REGISTRY PROPERTY, and it is not decoration: both
// `isChannelEnabled` (notification-preferences.ts) and `policyChannels`
// (notification-policy.ts) BRANCH ON IT, and each branch is a gate — the
// first decides whether a stored user preference may mute this event at all,
// the second whether an operator's deployment-wide kill switch may. Making
// the flag dynamic would push a PER-SEND value into the gate that decides
// whether a user may mute an event at all, which is to say: whoever composes
// a message would be handed the switch that overrides the recipient's
// preferences. That is the exact coupling `mandatory` exists to keep out of
// reach of anything but this file.
//
// Two keys is also THE ONLY REPRESENTATION UNDER WHICH THE PREFERENCES
// MATRIX CAN SHOW BOTH: a muteable row the user may switch off, and an
// unmuteable one rendered disabled with its reason (#126). One key carrying a
// per-send flag has exactly one row, and that row has to lie in one direction
// or the other — it either offers a toggle that some sends ignore, or hides a
// toggle that most sends would honour.
//
// The pair is otherwise deliberately identical: same channels, same default.
// The ONLY difference between them is who is in charge of muting them.
// ===========================================================================

export const BROADCASTS_NOTIFICATIONS: readonly NotificationRegistration[] = [
  {
    event: {
      key: 'admin.broadcast',
      label: 'Announcements',
      description:
        'Occasional messages an administrator sends to everyone using this application.',
      // All three channels: a broadcast has no shape of its own, so the medium is
      // the admin's choice per send — expressed as a NARROWING of this list (see
      // `NotifyOptions` in notification.types.ts), never as a widening of it.
      channels: ['email', 'browser', 'push'],
      defaultEnabled: true,
    },
    emailTemplate: 'broadcast',
    browserTemplate: broadcastBrowserTemplate,
  },
  {
    event: {
      key: 'admin.broadcast_critical',
      label: 'Important announcements',
      description:
        'Messages an administrator has marked as important — service interruptions, security notices and anything else everyone needs to see. These cannot be turned off.',
      channels: ['email', 'browser', 'push'],
      defaultEnabled: true,
      // A service interruption or a security notice nobody receives is the
      // failure this flag exists for, and it is the same argument
      // `security.role_changed` makes: silence is itself the risk.
      //
      // Note what this does NOT constrain: `mandatory` binds the RECIPIENT, not
      // the sender. An admin may still choose to send a critical broadcast over a
      // subset of channels — see `dispatch()` in notifications.service.ts, which
      // permits narrowing a mandatory event on purpose and says why.
      mandatory: true,
    },
    emailTemplate: 'broadcast',
    browserTemplate: broadcastBrowserTemplate,
  },
];
