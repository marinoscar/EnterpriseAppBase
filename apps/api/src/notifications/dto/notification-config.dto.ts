import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// =============================================================================
// GET /api/notifications/config — response (issue #226, epic #215)
// =============================================================================
//
// What the CLIENT needs to know about this deployment's notification
// capabilities, and nothing else.
//
// -----------------------------------------------------------------------------
// WHY THIS ENDPOINT EXISTS INSTEAD OF WIDENING `system_settings:read`
// -----------------------------------------------------------------------------
//
// #225 stores the browser-notification policy in system settings, and
// `GET /api/system-settings` is gated on `system_settings:read` — a permission
// the seeded `viewer` and `contributor` roles do not hold (see
// `prisma/seed.ts`, `ROLE_PERMISSIONS`: they hold `user_settings:read|write`
// and `storage:read`). So the users the policy AFFECTS are precisely the users
// who cannot read it.
//
// REJECTED — granting `system_settings:read` to `viewer`. It is one seed line
// and it is the wrong line. That permission returns the WHOLE settings blob,
// including the open `features` map that this repository deliberately leaves
// for downstream forks to fill with their own operational flags — so a fork's
// unreleased-feature switches, kill switches and rollout percentages would
// become readable by every account the day someone wanted a browser
// notification to behave. A capability probe should hand out the capability,
// not the configuration behind it.
//
// So: a narrow, purpose-built projection, readable by any authenticated user,
// carrying three booleans-worth of information and no policy detail. In
// particular it does NOT expose `disabledEvents` — which events an operator has
// muted is not something a client needs (the per-event answer arrives with the
// event, as the stream's `toast` flag) and it is a small map of what this
// deployment considers noisy.
// =============================================================================

export const notificationConfigSchema = z.object({
  /**
   * May this client raise browser notifications at all?
   *
   * THE PERMISSION-PROMPT GATE. A client asks the browser for Notification
   * permission only when this is `true`. Browser permission, once denied, is
   * effectively permanent and cannot be re-prompted, so prompting while the
   * capability is switched off spends a one-shot user decision on a feature
   * this deployment does not offer.
   *
   * NOT A DELIVERY GATE. `false` does not mean notifications stop: rows are
   * still written and the notification centre still fills. It means the OS
   * bubble is off. Per-event suppression is not visible here — it arrives with
   * each notification as `toast` on the stream, so a client cannot go stale on
   * it.
   */
  browserEnabled: z.boolean(),

  /**
   * May this client subscribe to Web Push?
   *
   * ALWAYS `false` TODAY. Web Push is #229 (the subscription store and the
   * VAPID keys) and #230 (the delivery channel and its own policy gate); this
   * field ships now so the client contract does not change shape when they
   * land, and so a client written against this endpoint has one place to look
   * for "what can this deployment do?" rather than two.
   */
  pushEnabled: z.boolean(),

  /**
   * The VAPID application server key a client needs to call
   * `pushManager.subscribe`, or `null` when push is unavailable.
   *
   * ALWAYS `null` TODAY, for the same reason `pushEnabled` is always `false`
   * (#229/#230). It is a PUBLIC key by definition — it is handed to every
   * browser that subscribes — so publishing it here to any authenticated user
   * gives nothing away; the private half never leaves the server.
   */
  vapidPublicKey: z.string().nullable(),
});

/** The client-facing notification capabilities of this deployment. */
export type NotificationConfigResponse = z.infer<
  typeof notificationConfigSchema
>;

export class NotificationConfigDto extends createZodDto(
  notificationConfigSchema,
) {}
