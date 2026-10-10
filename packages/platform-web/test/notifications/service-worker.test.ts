// The service-worker helpers an app's `sw.ts` calls (#738; behaviour moved
// from the reference app's worker, #222, #223, #230, #618). The scope is a
// structural fake: the helpers name only the members they call, and NONE of
// them may reach the API (no `fetch` on the fake, and `fetch` itself throws).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  handleNotificationClick,
  handlePushEvent,
  handlePushSubscriptionChange,
  registerNotificationServiceWorkerHandlers,
} from '../../src/notifications/headless/index.js';
import type { NotificationsServiceWorkerScope } from '../../src/notifications/headless/index.js';

interface FakeClient {
  url: string;
  focused: boolean;
  visibilityState: string;
  focus: ReturnType<typeof vi.fn>;
  postMessage: ReturnType<typeof vi.fn>;
}

function client(url: string, focused = false): FakeClient {
  return { url, focused, visibilityState: focused ? 'visible' : 'hidden', focus: vi.fn().mockResolvedValue(undefined), postMessage: vi.fn() };
}

function scope(clients: FakeClient[] = []) {
  const listeners = new Map<string, (event: unknown) => void>();
  const fake = {
    registration: {
      showNotification: vi.fn().mockResolvedValue(undefined),
      pushManager: { subscribe: vi.fn().mockResolvedValue({}) },
    },
    clients: {
      matchAll: vi.fn().mockResolvedValue(clients),
      openWindow: vi.fn().mockResolvedValue(null),
    },
    addEventListener: vi.fn((type: string, listener: (event: unknown) => void) => listeners.set(type, listener)),
  };
  return { fake, scope: fake as unknown as NotificationsServiceWorkerScope, listeners };
}

/** Runs a handler and awaits what it handed `waitUntil`. */
function extendable<T extends object>(fields: T) {
  const pending: Promise<unknown>[] = [];
  const event = { ...fields, waitUntil: (promise: Promise<unknown>) => pending.push(promise) };
  return { event, settled: () => Promise.all(pending) };
}

function pushEvent(payload: unknown) {
  return extendable({ data: payload === undefined ? null : { json: () => (typeof payload === 'string' ? JSON.parse(payload) : payload) } });
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn(() => Promise.reject(new Error('a service worker must never call the API'))));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('handlePushEvent', () => {
  const payload = { id: 'n1', eventKey: 'user.welcome', title: 'Hello', body: 'Welcome aboard', link: '/settings' };

  it('shows the payload, tagged with the notification id and carrying id and link for the click', async () => {
    const { scope: s, fake } = scope();
    await handlePushEvent(s, pushEvent(payload).event);
    expect(fake.registration.showNotification).toHaveBeenCalledWith('Hello', {
      body: 'Welcome aboard',
      tag: 'n1',
      icon: '/icons/icon-192.png',
      badge: '/icons/badge-96.png',
      data: { id: 'n1', link: '/settings' },
    });
  });

  it('uses the icons the app passes', async () => {
    const { scope: s, fake } = scope();
    await handlePushEvent(s, pushEvent(payload).event, { icon: '/i.png', badge: '/b.png' });
    expect(fake.registration.showNotification).toHaveBeenCalledWith('Hello', expect.objectContaining({ icon: '/i.png', badge: '/b.png' }));
  });

  it('shows a generic notification for a missing or malformed payload, never nothing', async () => {
    for (const event of [pushEvent(undefined).event, { data: { json: () => { throw new Error('bad'); } }, waitUntil: vi.fn() }]) {
      const { scope: s, fake } = scope();
      await handlePushEvent(s, event);
      expect(fake.registration.showNotification).toHaveBeenCalledWith(
        'New notification',
        expect.objectContaining({ body: 'You have a new notification', tag: 'push-fallback' }),
      );
    }
  });

  it('shows a test push and acknowledges it to every window client (#618)', async () => {
    const focused = client('https://app.test/admin/settings/push', true);
    const other = client('https://app.test/');
    const { scope: s, fake } = scope([focused, other]);
    await handlePushEvent(s, pushEvent({ ...payload, id: 'test-1', test: true }).event);
    expect(fake.registration.showNotification).toHaveBeenCalledWith('Hello', expect.objectContaining({ data: { id: '', link: '/settings', test: true } }));
    for (const c of [focused, other]) {
      expect(c.postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'push-test-received', id: 'test-1', shown: true, hadFocusedClient: true }),
      );
    }
  });

  it('still acknowledges a test push whose notification could not be shown', async () => {
    const page = client('https://app.test/');
    const { scope: s, fake } = scope([page]);
    fake.registration.showNotification.mockRejectedValue(new TypeError('no permission'));
    await handlePushEvent(s, pushEvent({ ...payload, test: true }).event);
    expect(page.postMessage).toHaveBeenCalledWith(expect.objectContaining({ shown: false, error: 'TypeError: no permission' }));
  });
});

describe('handleNotificationClick', () => {
  function click(data: unknown) {
    const close = vi.fn();
    return { close, ...extendable({ notification: { close, data } }) };
  }

  it('closes the notification, focuses the window already on the link and posts it the click', async () => {
    const home = client('https://app.test/');
    const settings = client('https://app.test/settings');
    const { scope: s, fake } = scope([home, settings]);
    const { event, settled, close } = click({ id: 'n1', link: '/settings?tab=1' });
    handleNotificationClick(s, event);
    await settled();
    expect(close).toHaveBeenCalled();
    expect(settings.focus).toHaveBeenCalled();
    expect(settings.postMessage).toHaveBeenCalledWith({ type: 'notification-click', id: 'n1', link: '/settings?tab=1' });
    expect(home.postMessage).not.toHaveBeenCalled();
    expect(fake.clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a window with the id in ?n= when no page is open', async () => {
    const { scope: s, fake } = scope([]);
    const { event, settled } = click({ id: 'n 1', link: '/settings?tab=1' });
    handleNotificationClick(s, event);
    await settled();
    expect(fake.clients.openWindow).toHaveBeenCalledWith('/settings?tab=1&n=n%201');
  });

  it('re-validates the link: an off-origin or protocol-relative link falls back to /', async () => {
    for (const link of ['//evil.example/phish', 'https://evil.example/', 'javascript:alert(1)', 42]) {
      const { scope: s, fake } = scope([]);
      const { event, settled } = click({ id: 'n1', link });
      handleNotificationClick(s, event);
      await settled();
      expect(fake.clients.openWindow).toHaveBeenCalledWith('/?n=n1');
    }
  });
});

describe('handlePushSubscriptionChange', () => {
  it('resubscribes with the old key, best effort', async () => {
    const { scope: s, fake } = scope();
    const key = new ArrayBuffer(8);
    await handlePushSubscriptionChange(s, { oldSubscription: { options: { applicationServerKey: key } }, waitUntil: vi.fn() });
    expect(fake.registration.pushManager.subscribe).toHaveBeenCalledWith({ applicationServerKey: key, userVisibleOnly: true });
  });

  it('does nothing without an old key, and never rejects on a failed resubscribe', async () => {
    const { scope: s, fake } = scope();
    await handlePushSubscriptionChange(s, { oldSubscription: null, waitUntil: vi.fn() });
    expect(fake.registration.pushManager.subscribe).not.toHaveBeenCalled();
    fake.registration.pushManager.subscribe.mockRejectedValue(new Error('gone'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      handlePushSubscriptionChange(s, { oldSubscription: { options: { applicationServerKey: new ArrayBuffer(1) } }, waitUntil: vi.fn() }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});

describe('registerNotificationServiceWorkerHandlers', () => {
  it('adds the three listeners, each keeping the worker alive until its work settles', async () => {
    const { scope: s, fake, listeners } = scope();
    registerNotificationServiceWorkerHandlers(s, { icon: '/i.png' });
    expect([...listeners.keys()].sort()).toEqual(['notificationclick', 'push', 'pushsubscriptionchange']);

    const push = pushEvent({ id: 'n1', eventKey: 'e', title: 'T', body: 'B', link: '/' });
    (listeners.get('push') as (event: unknown) => void)(push.event);
    await push.settled();
    expect(fake.registration.showNotification).toHaveBeenCalledWith('T', expect.objectContaining({ icon: '/i.png' }));
  });

  it('never calls the API', async () => {
    const { scope: s, listeners } = scope([client('https://app.test/')]);
    registerNotificationServiceWorkerHandlers(s);
    const push = pushEvent({ id: 'n1', eventKey: 'e', title: 'T', body: 'B', link: '/' });
    (listeners.get('push') as (event: unknown) => void)(push.event);
    const close = vi.fn();
    const clickEvent = extendable({ notification: { close, data: { id: 'n1', link: '/' } } });
    (listeners.get('notificationclick') as (event: unknown) => void)(clickEvent.event);
    await Promise.all([push.settled(), clickEvent.settled()]);
    expect(fetch).not.toHaveBeenCalled();
  });
});
