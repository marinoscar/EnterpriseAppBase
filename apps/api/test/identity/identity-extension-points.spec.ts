import { Injectable, type CanActivate } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import request from 'supertest';
import { withTemporaryEntries } from '@marinoscar/platform-api/core';
import {
  IDENTITY_EVENTS,
  IDENTITY_NOTIFIER,
  USER_DEFAULTS,
  authProviderRegistry,
  type AuthProviderRegistration,
  type IdentityNotifier,
  type UserDefaults,
} from '@marinoscar/platform-api/identity';

import { DEFAULT_USER_SETTINGS } from '../../src/common/types/settings.types';
import { IdentityUserCreatedListener } from '../../src/identity-extensions/identity-user-created.listener';
import { NotificationsService } from '../../src/notifications/notifications.service';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';
import { resetPrismaMock } from '../mocks/prisma.mock';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';

// =============================================================================
// The identity slice's extension points, as the reference app uses them (#727)
// =============================================================================
//
// - registerAuthProvider: a provider registered by the app is listed by
//   GET /api/auth/providers once it is configured, after Google.
// - IDENTITY_NOTIFIER and USER_DEFAULTS: bound to the app's dispatcher and to
//   DEFAULT_USER_SETTINGS (platform/identity/identity-host.module.ts).
// - identity.user.created: the app's example listener receives it.
// =============================================================================

describe('identity extension points in the reference app', () => {
  let context: TestContext;

  beforeAll(async () => {
    context = await createTestApp({ useMockDatabase: true });
  });

  afterAll(async () => {
    await closeTestApp(context);
  });

  beforeEach(() => {
    resetPrismaMock();
    setupBaseMocks();
  });

  it('lists an app-registered sign-in provider after Google, when it is configured', async () => {
    @Injectable()
    class ExampleStrategy {}
    class ExampleGuard implements CanActivate {
      canActivate(): boolean {
        return false;
      }
    }
    const example: AuthProviderRegistration = {
      id: 'example',
      strategy: ExampleStrategy,
      guard: ExampleGuard,
      isEnabled: () => true,
    };

    await withTemporaryEntries(authProviderRegistry, [example], async () => {
      const res = await request(context.app.getHttpServer()).get('/api/auth/providers').expect(200);
      expect(res.body.data.providers.map((provider: { name: string }) => provider.name)).toEqual(['google', 'example']);
    });
  });

  it('binds IDENTITY_NOTIFIER to the dispatcher with the event keys identity always raised', async () => {
    const notifier = context.module.get<IdentityNotifier>(IDENTITY_NOTIFIER);
    const dispatcher = context.module.get(NotificationsService);
    const notify = jest.spyOn(dispatcher, 'notify').mockResolvedValue(undefined as never);
    const notifyAddress = jest.spyOn(dispatcher, 'notifyAddress').mockResolvedValue(undefined as never);
    try {
      await notifier.userWelcomed('user-1', { recipientEmail: 'a@b.co', roles: ['viewer'] });
      await notifier.roleChanged('user-1', { recipientEmail: 'a@b.co', previousRoles: [], currentRoles: ['viewer'], changedAt: new Date(0) });
      await notifier.allowlistInvitation('c@d.co', { recipientEmail: 'c@d.co' });
      await notifier.orgInvitation('e@f.co', { recipientEmail: 'e@f.co', orgName: 'Acme', roleName: 'viewer' });
      expect(notify.mock.calls.map((call) => call[0])).toEqual(['user.welcome', 'security.role_changed']);
      expect(notifyAddress.mock.calls.map((call) => call[0])).toEqual(['allowlist.invitation', 'org.invitation']);
    } finally {
      notify.mockRestore();
      notifyAddress.mockRestore();
    }
  });

  it('binds USER_DEFAULTS to a fresh copy of DEFAULT_USER_SETTINGS', () => {
    const defaults = context.module.get<UserDefaults>(USER_DEFAULTS);
    const first = defaults.userSettings();
    expect(first).toEqual(DEFAULT_USER_SETTINGS);
    expect(first).not.toBe(defaults.userSettings());
  });

  it('delivers identity.user.created to the app listener', () => {
    const listener = context.module.get(IdentityUserCreatedListener);
    const onUserCreated = jest.spyOn(listener, 'onUserCreated');
    try {
      context.module.get(EventEmitter2).emit(IDENTITY_EVENTS.USER_CREATED, { userId: 'u-1', email: 'a@b.co', source: 'google', orgId: null });
      expect(onUserCreated).toHaveBeenCalledWith({ userId: 'u-1', email: 'a@b.co', source: 'google', orgId: null });
    } finally {
      onUserCreated.mockRestore();
    }
  });
});
