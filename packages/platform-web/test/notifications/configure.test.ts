// configureNotificationsWeb (#738): the slice's services reach the API only
// through the client the app configured at startup; a call before that names
// the fix instead of failing obscurely.
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('configureNotificationsWeb', () => {
  afterEach(() => {
    vi.resetModules();
  });

  it('throws a named error when a service runs before configuration', async () => {
    const { getUnreadNotificationCount } = await import('../../src/notifications/headless/api.js');
    await expect(getUnreadNotificationCount()).rejects.toThrow(/configureNotificationsWeb/);
  });

  it('routes every call through the configured client, at call time', async () => {
    const { configureNotificationsWeb } = await import('../../src/notifications/headless/index.js');
    const { getUnreadNotificationCount, markNotificationRead } = await import('../../src/notifications/headless/api.js');
    const api = {
      get: vi.fn().mockResolvedValue({ unreadCount: 3 }),
      post: vi.fn().mockResolvedValue({ unreadCount: 2 }),
      put: vi.fn(),
      delete: vi.fn(),
    };
    configureNotificationsWeb({ api, apiBaseUrl: '/api' });
    await expect(getUnreadNotificationCount()).resolves.toEqual({ unreadCount: 3 });
    await markNotificationRead('n1');
    expect(api.get.mock.calls[0]?.[0]).toBe('/notifications/unread-count');
    expect(api.post.mock.calls[0]?.[0]).toBe('/notifications/n1/read');
  });
});
