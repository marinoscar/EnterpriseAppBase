import { Inject, Injectable, OnModuleInit } from '@nestjs/common';

import {
  EgressContributor,
  EgressDependency,
  EgressRegistry,
  egressDependency,
  hostnameOf,
} from '../../../doctor/index';

import { PLATFORM_PRISMA, asSystem } from '../../../core/index';
import type { NotificationsPrisma } from '../../data/notifications-db';
import { PushConfigService } from '../../push-config.service';
import { PUSH_SETTINGS_PATH } from '../push-vapid.doctor-check';

/** The most subscription rows one inventory reads. Hosts repeat; a bounded scan finds them all in practice. */
export const PUSH_ENDPOINT_SCAN_LIMIT = 10_000;

/**
 * The push services browsers register with, for a deployment that has push on
 * but no subscriber yet: the next one will use one of these. All public.
 */
export const KNOWN_PUSH_SERVICE_HOSTS = [
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
  'web.push.apple.com',
] as const;

/**
 * `push.web-push` (#773): Web Push sends each notification to the push service
 * the subscriber's browser chose (`PushSubscription.endpoint`, for example
 * `https://fcm.googleapis.com/fcm/send/<token>`), which is always on the
 * internet.
 *
 * Enabled when push is switched on and a VAPID pair is configured, read through
 * `PushConfigService.describeForAdmin()` (the masked view; NEVER
 * `resolveActiveVapidConfig()`, which returns the private key). Then one
 * bounded, system-wide read of the `endpoint` column only, reduced in memory to
 * HOSTNAMES ordered by subscriber count: an endpoint's path is a capability
 * URL, so nothing past the host ever leaves this method. `count` is the number
 * of subscriptions read.
 */
@Injectable()
export class WebPushEgressContributor implements EgressContributor, OnModuleInit {
  readonly id = 'push';

  constructor(
    private readonly egress: EgressRegistry,
    private readonly pushConfig: PushConfigService,
    @Inject(PLATFORM_PRISMA) private readonly prisma: NotificationsPrisma,
  ) {}

  onModuleInit(): void {
    this.egress.register(this);
  }

  async describe(): Promise<EgressDependency[]> {
    const view = await this.pushConfig.describeForAdmin();
    const enabled = view.enabled && view.configured && view.settingsError === null;

    let hosts: string[] = [];
    let count: number | undefined;

    if (enabled) {
      const rows: Array<{ endpoint: string }> = await asSystem(this.prisma, {
        kind: 'system',
        reason: 'doctor.network-egress: push service hosts',
      }).pushSubscription.findMany({ select: { endpoint: true }, take: PUSH_ENDPOINT_SCAN_LIMIT });

      const perHost = new Map<string, number>();
      for (const { endpoint } of rows) {
        const host = hostnameOf(endpoint);
        if (host !== null) perHost.set(host, (perHost.get(host) ?? 0) + 1);
      }

      count = rows.length;
      hosts =
        perHost.size > 0
          ? [...perHost.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([host]) => host)
          : [...KNOWN_PUSH_SERVICE_HOSTS];
    }

    return [
      egressDependency({
        id: 'push.web-push',
        capability: 'Web Push',
        direction: 'server',
        enabled,
        required: false,
        hosts,
        degradation: 'Browser push notifications are not delivered; the in-app inbox still is',
        settingsPath: PUSH_SETTINGS_PATH,
        ...(count !== undefined ? { count } : {}),
      }),
    ];
  }
}
