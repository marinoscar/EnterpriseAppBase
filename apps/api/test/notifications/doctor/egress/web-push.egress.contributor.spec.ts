import { EgressRegistry } from '@marinoscar/platform-api/doctor';

import type { NotificationsPrisma } from '../../support/notifications';
import { PushConfigService } from '../../support/notifications';
import {
  KNOWN_PUSH_SERVICE_HOSTS,
  PUSH_ENDPOINT_SCAN_LIMIT,
  WebPushEgressContributor,
} from '../../support/notifications';

function setup(view: { enabled: boolean; configured: boolean; settingsError?: string | null }, endpoints: string[] = []) {
  const findMany = jest.fn().mockResolvedValue(endpoints.map((endpoint) => ({ endpoint })));
  // The contributor reads through the core `asSystem(client, actor)` marker
  // since #738 (it returns the client unchanged), not `ScopedPrismaService`.
  const prisma = { pushSubscription: { findMany } };
  const pushConfig = {
    describeForAdmin: jest.fn().mockResolvedValue({ settingsError: null, ...view }),
    resolveActiveVapidConfig: jest.fn(),
  };
  const subject = new WebPushEgressContributor(
    new EgressRegistry(),
    pushConfig as unknown as PushConfigService,
    prisma as unknown as NotificationsPrisma,
  );
  return { subject, findMany, pushConfig };
}

describe('WebPushEgressContributor (#773)', () => {
  it('is disabled, and reads no subscription, while push is off', async () => {
    const { subject, findMany } = setup({ enabled: false, configured: true });
    const [dep] = await subject.describe();

    expect(dep).toMatchObject({ id: 'push.web-push', enabled: false, hosts: [] });
    expect(dep).not.toHaveProperty('count');
    expect(findMany).not.toHaveBeenCalled();
  });

  it('is disabled when the key pair is incomplete or the row is damaged', async () => {
    expect((await setup({ enabled: true, configured: false }).subject.describe())[0]?.enabled).toBe(false);
    expect((await setup({ enabled: true, configured: true, settingsError: 'bad' }).subject.describe())[0]?.enabled).toBe(
      false,
    );
  });

  it('groups subscription endpoints by host, ordered by count, with a bounded endpoint-only system read', async () => {
    const { subject, findMany } = setup({ enabled: true, configured: true }, [
      'https://fcm.googleapis.com/fcm/send/secret-token-1',
      'https://updates.push.services.mozilla.com/wpush/v2/secret-token-2',
      'https://fcm.googleapis.com/fcm/send/secret-token-3',
      'not a url',
    ]);
    const [dep] = await subject.describe();

    expect(findMany).toHaveBeenCalledWith({ select: { endpoint: true }, take: PUSH_ENDPOINT_SCAN_LIMIT });
    expect(PUSH_ENDPOINT_SCAN_LIMIT).toBe(10_000);
    expect(dep).toMatchObject({
      enabled: true,
      scope: 'public',
      count: 4,
      hosts: ['fcm.googleapis.com', 'updates.push.services.mozilla.com'],
    });
    expect(JSON.stringify(dep)).not.toMatch(/secret-token|fcm\/send|wpush/);
  });

  it('falls back to the well-known push services when push is on with no subscriber', async () => {
    const [dep] = await setup({ enabled: true, configured: true }, []).subject.describe();

    expect(dep).toMatchObject({ enabled: true, count: 0, hosts: [...KNOWN_PUSH_SERVICE_HOSTS], scope: 'public' });
  });

  it('never touches the VAPID private key accessor', async () => {
    const { subject, pushConfig } = setup({ enabled: true, configured: true }, []);
    await subject.describe();

    expect(pushConfig.resolveActiveVapidConfig).not.toHaveBeenCalled();
  });
});
