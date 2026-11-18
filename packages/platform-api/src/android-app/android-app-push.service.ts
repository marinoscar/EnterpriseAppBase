import { randomUUID } from 'node:crypto';

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  AndroidAppTestNotificationResponse,
  AndroidAppTestResultRow,
  AndroidAppTestStatus,
} from '@marinoscar/platform-contract/android-app';
import type { PushTestSendResult } from '@marinoscar/platform-contract/notifications';

import { AUDIT_SINK, PLATFORM_PRISMA, type AuditSink } from '../core/index';
import { PushConfigService, PushTestService, endpointHost } from '../notifications/index';
import { ANDROID_APP_OPTIONS, type ResolvedAndroidAppModuleOptions } from './android-app.options';
import type { AndroidAppPrisma } from './data/android-app-db';

// =============================================================================
// AndroidAppPushService (#746; harvested from EvoPath #312)
// =============================================================================
//
// `POST /api/admin/android-app/test-notification`: one Web Push to every
// `android_app` subscription of the target user, through the deployment's
// VAPID configuration (runtime-configured; there is no environment variable).
// Not a notification: no inbox row, preferences do not apply. Reuses the
// push test's sender (same TTL, urgency, pruning). Audited with the counts
// and hosts only: an endpoint is a capability URL.
// =============================================================================

/**
 * The audit action of a test notification.
 *
 * @stability experimental
 */
export const ANDROID_APP_TEST_NOTIFICATION_ACTION = 'android_app.test_notification.sent';

/**
 * The event key the payload carries, so the service worker can recognise a test.
 *
 * @stability experimental
 */
export const ANDROID_APP_TEST_EVENT_KEY = 'android_app.test';

/**
 * One subscription's outcome, from the push test's result.
 *
 * @param subscriptionId - the row id.
 * @param endpoint - the endpoint (only its host is kept).
 * @param sent - the send result, or undefined.
 * @returns the row.
 *
 * @stability experimental
 */
export function toResultRow(subscriptionId: string, endpoint: string, sent: PushTestSendResult | undefined): AndroidAppTestResultRow {
  const host = endpointHost(endpoint);
  if (sent?.status === 'sent') return { subscriptionId, endpointHost: host, status: 'sent' };
  if (sent?.status === 'pruned') {
    return { subscriptionId, endpointHost: host, status: 'gone', error: 'The push service no longer knows this subscription; it was removed.' };
  }
  return { subscriptionId, endpointHost: host, status: 'failed', error: sent?.message ?? 'Not sent.' };
}

/**
 * Sends the Android app test notification.
 *
 * @stability experimental
 */
@Injectable()
export class AndroidAppPushService {
  private readonly logger = new Logger(AndroidAppPushService.name);

  constructor(
    @Inject(PLATFORM_PRISMA) private readonly prisma: AndroidAppPrisma,
    private readonly pushConfig: PushConfigService,
    private readonly pushTest: PushTestService,
    @Inject(AUDIT_SINK) private readonly audit: AuditSink,
    @Inject(ANDROID_APP_OPTIONS) private readonly options: ResolvedAndroidAppModuleOptions,
  ) {}

  /**
   * Pushes the test to `targetUserId` (default the actor).
   *
   * @param actorUserId - the administrator.
   * @param targetUserId - the user to push to.
   * @returns per-subscription outcomes, or a `reason` for an empty send.
   * @throws NotFoundException when the target user does not exist.
   */
  async sendTest(actorUserId: string, targetUserId?: string): Promise<AndroidAppTestNotificationResponse> {
    const userId = targetUserId ?? actorUserId;
    if (targetUserId && targetUserId !== actorUserId) {
      const exists = await this.prisma.user.findUnique({ where: { id: targetUserId }, select: { id: true } });
      if (!exists) throw new NotFoundException('User not found');
    }
    const [active, subscriptions] = await Promise.all([
      this.pushConfig.resolveActiveVapidConfig(),
      this.prisma.pushSubscription.findMany({ where: { userId, platform: 'android_app' }, orderBy: { createdAt: 'asc' } }),
    ]);

    let result: AndroidAppTestNotificationResponse;
    if (!active) {
      result = { userId, androidSubscriptions: subscriptions.length, results: [], reason: 'PUSH_NOT_CONFIGURED' };
    } else if (subscriptions.length === 0) {
      result = { userId, androidSubscriptions: 0, results: [], reason: 'NO_ANDROID_SUBSCRIPTION' };
    } else {
      const payload = JSON.stringify({
        id: `android-app-test-${randomUUID()}`,
        eventKey: ANDROID_APP_TEST_EVENT_KEY,
        title: `${this.options.appName} test notification`,
        body: 'If you can read this on your phone, Android app notifications work.',
        link: this.options.testNotificationLink,
        test: true,
      });
      const sent = await this.pushTest.sendToSubscriptions(active, subscriptions, payload);
      result = {
        userId,
        androidSubscriptions: subscriptions.length,
        results: subscriptions.map((subscription: { id: string; endpoint: string }, index: number) =>
          toResultRow(subscription.id, subscription.endpoint, sent[index]),
        ),
      };
    }

    const counts: Record<AndroidAppTestStatus, number> = { sent: 0, failed: 0, gone: 0 };
    for (const row of result.results) counts[row.status]++;
    this.logger.log(
      `Android app test notification by ${actorUserId} to ${userId}: ` +
        (result.reason ?? `${counts.sent} sent, ${counts.failed} failed, ${counts.gone} gone`),
    );
    try {
      await this.audit.record({
        action: ANDROID_APP_TEST_NOTIFICATION_ACTION,
        actorUserId,
        targetType: 'user',
        targetId: userId,
        meta: {
          androidSubscriptions: result.androidSubscriptions,
          sent: counts.sent,
          failed: counts.failed,
          gone: counts.gone,
          hosts: [...new Set(result.results.map((row) => row.endpointHost))].join(','),
          reason: result.reason ?? null,
        },
      });
    } catch (error) {
      this.logger.warn(`Android app test notification: could not record the audit event: ${error instanceof Error ? error.message : String(error)}`);
    }
    return result;
  }
}
