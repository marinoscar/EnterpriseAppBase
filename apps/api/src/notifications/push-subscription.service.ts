import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import type { PushSubscribeRequest } from './dto/push-subscription.dto';

// =============================================================================
// PushSubscriptionService (issue #229, epic #215)
// =============================================================================
//
// Storage for the browser's `PushSubscription` object, keyed by its endpoint.
// This is the write/delete half of #229; #230 is the (separate, future) sender
// that actually reads these rows and pushes to them.
//
// Decomposed out of the module the same way `NotificationStoreService`,
// `NotificationStreamService` and `NotificationPolicyService` are: a provider
// with one narrow job, reached only through the controller. See
// `notifications.module.ts` for why none of the four are exported.
//
// -----------------------------------------------------------------------------
// `isEnabled()` REQUIRES PUBLIC + PRIVATE, NOT `VAPID_SUBJECT`
// -----------------------------------------------------------------------------
//
// A public key with no private key is useless: nothing on this server could
// sign a push, so accepting subscriptions would just accumulate rows #230 can
// never deliver to. Both halves of the key pair are therefore required.
//
// `VAPID_SUBJECT` is different in kind — it is contact metadata (a `mailto:`
// or `https:` URL) that `web-push` puts in the VAPID JWT so a push service
// operator has somewhere to reach the sender of unwanted traffic. It affects
// how nicely #230 behaves toward push services, not whether signing is
// possible at all, so its absence does not belong in the same gate as a
// missing key. (#230, when it lands, is free to warn or refuse to send with no
// subject configured — that is a delivery-time concern, not a subscription-time
// one.)
// =============================================================================

@Injectable()
export class PushSubscriptionService {
  private readonly logger = new Logger(PushSubscriptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Whether this deployment has enough VAPID configuration to accept push
   * subscriptions at all. See the file header for why `VAPID_SUBJECT` is not
   * part of this check.
   */
  isEnabled(): boolean {
    const publicKey = this.config.get<string>('push.vapidPublicKey');
    const privateKey = this.config.get<string>('push.vapidPrivateKey');
    return Boolean(publicKey) && Boolean(privateKey);
  }

  /**
   * The VAPID public key a client needs to call `pushManager.subscribe`, or
   * `null` when this deployment has none configured.
   */
  getVapidPublicKey(): string | null {
    return this.config.get<string>('push.vapidPublicKey') ?? null;
  }

  /**
   * Upsert a browser's push subscription by its `endpoint`.
   *
   * UPSERT-BY-ENDPOINT, NOT BY `(userId, endpoint)`. `endpoint` is `@unique`
   * on its own in the schema precisely so this can key off it alone: the same
   * browser subscription re-registering under a different signed-in user (a
   * shared machine, a re-login) MOVES the row to the new owner rather than
   * forking a duplicate that would leave the old owner still receiving pushes
   * meant for someone else, or leave two rows racing to the same endpoint. A
   * composite `(userId, endpoint)` key would instead create a second row for
   * the second user while the endpoint is still valid for only one of them.
   *
   * On update, `failureCount` is reset to `0` — a subscription actively being
   * re-registered by the browser is evidence it is alive, which is exactly
   * what should clear a prior run of send failures. `lastSuccessAt` is left
   * untouched here: it is written only by #230's sender on an actual
   * successful delivery, never inferred from a client re-subscribing.
   */
  async subscribe(
    userId: string,
    dto: PushSubscribeRequest,
    userAgent: string | undefined,
  ): Promise<{ id: string; endpoint: string; createdAt: Date }> {
    if (!this.isEnabled()) {
      // ConflictException (409): the closest existing vocabulary in this
      // codebase for "this state prevents the operation" (see
      // `allowlist.service.ts`'s duplicate-email check and the settings
      // services' If-Match mismatch), and a better fit than 400 — the request
      // body itself is perfectly valid, it is the DEPLOYMENT's state (no
      // VAPID keys configured) that makes the operation impossible right now.
      throw new ConflictException(
        'Web Push is not enabled on this deployment',
      );
    }

    const expirationTime =
      dto.expirationTime == null ? null : new Date(dto.expirationTime);

    const subscription = await this.prisma.pushSubscription.upsert({
      where: { endpoint: dto.endpoint },
      update: {
        userId,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        expirationTime,
        userAgent: userAgent ?? null,
        failureCount: 0,
      },
      create: {
        userId,
        endpoint: dto.endpoint,
        p256dh: dto.keys.p256dh,
        auth: dto.keys.auth,
        expirationTime,
        userAgent: userAgent ?? null,
      },
    });

    this.logger.log(
      `Upserted push subscription ${subscription.id} for user ${userId}`,
    );

    return {
      id: subscription.id,
      endpoint: subscription.endpoint,
      createdAt: subscription.createdAt,
    };
  }

  /**
   * Remove one of the caller's own push subscriptions by endpoint.
   *
   * `deleteMany({ where: { userId, endpoint } })`, NOT `findFirst` + `delete`
   * and NOT a bare `delete({ where: { endpoint } })`. There is no compound
   * `(userId, endpoint)` unique constraint — only `endpoint` is unique — so a
   * single-statement `delete` keyed on `endpoint` alone could remove a row
   * owned by a different user. Folding the ownership check into the `where`
   * clause of one `deleteMany` (matching `pat.service.ts`'s ownership-scoped
   * pattern) means there is no window between checking and deleting, and no
   * code path that deletes a row this caller does not own.
   *
   * `count === 0` covers BOTH "no such endpoint" and "that endpoint belongs to
   * someone else" — deliberately indistinguishable, matching this codebase's
   * existing precedent (`notification-store.service.ts`'s `markRead`: "an id
   * belonging to another user returns 404, identical to an id that does not
   * exist"). Thrown here, in the service — matching `pat.service.ts`'s
   * `revokeToken`, not left for the controller to translate — so there is one
   * place that decides what "not found" means for this table.
   */
  async unsubscribe(userId: string, endpoint: string): Promise<void> {
    const result = await this.prisma.pushSubscription.deleteMany({
      where: { userId, endpoint },
    });

    if (result.count === 0) {
      throw new NotFoundException('Push subscription not found');
    }

    this.logger.log(
      `Removed push subscription for endpoint ${endpoint} (user ${userId})`,
    );
  }
}
