import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { build } from 'vite';
import { buildServiceWorkerOptions } from '../../../pwa/service-worker';

// -----------------------------------------------------------------------------
// `notificationclick` (issue #223, epic #215) — the one part of `sw.ts` that
// CAN be executed under jsdom, with its two side-effecting dependencies
// (workbox, and the real `self.clients`) replaced.
//
// The suite above cannot import `src/sw.ts` at all: unmocked, it calls
// `clientsClaim()` and registers routes against workbox internals that assume
// a real `ServiceWorkerGlobalScope`, which jsdom does not provide. Mocking
// `workbox-core`/`workbox-precaching`/`workbox-routing` to no-ops removes
// every one of those calls' real side effects, which is enough for the module
// to load — the two handlers it registers with `self.addEventListener` are
// then just plain functions, captured below by spying on `addEventListener`
// and invoked directly with a hand-built fake event, bypassing jsdom's lack of
// a real `NotificationEvent` entirely.
// -----------------------------------------------------------------------------

vi.mock('workbox-core', () => ({ clientsClaim: vi.fn() }));
vi.mock('workbox-precaching', () => ({
  cleanupOutdatedCaches: vi.fn(),
  createHandlerBoundToURL: vi.fn(() => vi.fn()),
  precacheAndRoute: vi.fn(),
}));
vi.mock('workbox-routing', () => ({
  NavigationRoute: vi.fn(),
  registerRoute: vi.fn(),
}));

// =============================================================================
// The service worker  (issue #218, epic #215)
// =============================================================================
//
// WHAT THIS SUITE CAN AND CANNOT DO
//
// It cannot execute `src/sw.ts`. That module is written for a
// ServiceWorkerGlobalScope — it calls `clientsClaim()` and registers fetch
// routes at import time, against a `self` jsdom does not provide — so merely
// importing it here would throw, and a mock complete enough to make it run
// would be a mock of the thing under test. The genuinely load-bearing
// behaviour (does a `push` handler fire, does `showNotification` work on
// Android) is a real-device question that no unit test settles.
//
// What IS checkable, and is checked here, are the two build-time invariants
// that would silently break the feature and that nothing else enforces:
//
//   1. `sw.js` is emitted at the ROOT of the build output. A service worker's
//      scope is capped by the directory it is served from, so a worker at
//      `/assets/sw.js` can only ever control `/assets/*` — it would register
//      without error, then never control a single page of the app, and never
//      be able to show a notification for one.
//
//   2. NOTHING under `/api` enters the precache. Cache Storage is origin-scoped
//      and survives logout, and it is not partitioned per account, so an
//      authenticated JSON response cached here is readable by the next person
//      to sign in on a shared device. Today `dist/` simply contains no API
//      responses — but that is a property of what the build emits, not a rule
//      anyone wrote down, so it is asserted rather than assumed.
//
// The build below is a real `vite build` into a temporary directory, which
// takes ~1.5s. That is affordable precisely because it is ONE build shared by
// every case in the file — do not add a second.
// =============================================================================

const webRoot = resolve(__dirname, '..', '..', '..');

let outDir: string;
/** Every file emitted at the top level of the build output. */
let rootEntries: string[];
/** The bundled service worker's source text. */
let swSource: string;
/** Every URL in the injected precache manifest, in build order. */
let precachedUrls: string[];

beforeAll(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'web-sw-build-'));

  await build({
    root: webRoot,
    // The suite asserts on the emitted files, never on the log, and a full
    // Rollup report in the middle of a test run is just noise.
    logLevel: 'error',
    build: {
      outDir,
      emptyOutDir: true,
      // Sourcemaps are ~4x the byte volume of this build and nothing here
      // reads them.
      sourcemap: false,
    },
  });

  rootEntries = readdirSync(outDir);
  swSource = readFileSync(join(outDir, 'sw.js'), 'utf-8');
  // vite-plugin-pwa substitutes `self.__WB_MANIFEST` with a literal array of
  // `{ revision, url }` records, so the emitted worker carries its own precache
  // list in plain text. Reading it back is the only way to see what the build
  // ACTUALLY decided to cache, as opposed to what the glob patterns intended.
  precachedUrls = [...swSource.matchAll(/"url":\s*"([^"]*)"/g)].map((match) => match[1]);
}, 120_000);

afterAll(() => {
  if (outDir) rmSync(outDir, { recursive: true, force: true });
});

describe('service worker build output', () => {
  it('emits sw.js at the root of the output, which is what gives it root scope', () => {
    // A worker served from a subdirectory is scope-capped to that
    // subdirectory. `/sw.js` is the only path that can control `/`.
    expect(rootEntries).toContain('sw.js');
    expect(existsSync(join(outDir, 'assets', 'sw.js'))).toBe(false);
  });

  it('precaches nothing under /api', () => {
    // Both spellings: a root-relative `api/...` entry (what a file emitted into
    // `dist/api/` would look like) and an absolute `/api/...` one.
    const leaked = precachedUrls.filter(
      (url) => /^\/?api\//.test(url) || url.includes('/api/'),
    );

    expect(
      leaked,
      `precache entries under /api — authenticated data in Cache Storage outlives logout: ${leaked.join(', ')}`,
    ).toEqual([]);
  });

  it('precaches the app shell it needs to load offline', () => {
    // The point of the precache. `index.html` is what the NavigationRoute in
    // `sw.ts` serves for every client-side route; the font is called out
    // because losing it degrades the offline shell into a visibly different
    // application rather than failing outright.
    expect(precachedUrls).toContain('index.html');
    expect(precachedUrls.some((url) => url.endsWith('.js'))).toBe(true);
    expect(precachedUrls.some((url) => url.endsWith('.css'))).toBe(true);
    expect(precachedUrls.some((url) => url.endsWith('.woff2'))).toBe(true);
  });

  it('emits the web manifest that VitePWA took over from issue #217', () => {
    // #218 deleted the hand-rolled `webManifest()` emitter. This is the
    // assertion that the replacement still does its job — without it, the app
    // silently stops being installable, and on iOS that removes the whole of
    // epic #215 from every iPhone and iPad.
    expect(rootEntries).toContain('manifest.webmanifest');

    const manifest = JSON.parse(readFileSync(join(outDir, 'manifest.webmanifest'), 'utf-8'));
    expect(manifest.display).toBe('standalone');
  });

  it('registers the worker from the React tree, not from index.html', () => {
    // Rewritten by issue #219, as the assertion it replaces said it should be.
    // Registration moved into `components/pwa/UpdatePrompt.tsx`
    // (`useRegisterSW`), so `injectRegister` is now `null` and the injected
    // `registerSW.js` is gone. Both halves are asserted: an app that never
    // registers its worker has no notifications on Android at all, and one that
    // registers TWICE has a hook whose state does not describe the registration
    // the user is on.
    const html = readFileSync(join(outDir, 'index.html'), 'utf-8');
    expect(html).not.toMatch(/registerSW\.js/);

    const bundled = readdirSync(join(outDir, 'assets'))
      .filter((file) => file.endsWith('.js'))
      .map((file) => readFileSync(join(outDir, 'assets', file), 'utf-8'));

    expect(
      bundled.some((source) => source.includes('serviceWorker.register')),
      'no emitted chunk registers a service worker — the PWA is inert',
    ).toBe(true);
  });
});

describe('buildServiceWorkerOptions', () => {
  it('uses injectManifest so the worker can host the push handlers', () => {
    // `generateSW` cannot host `push` / `notificationclick` /
    // `pushsubscriptionchange`, which on Android Chrome are the only way a
    // notification can be shown at all. Switching this back would leave the
    // build green and the feature dead on that platform.
    expect(buildServiceWorkerOptions().strategies).toBe('injectManifest');
  });

  it('points at a service worker source file that exists', () => {
    const { srcDir, filename } = buildServiceWorkerOptions();

    expect(filename).toBe('sw.ts');
    expect(existsSync(resolve(webRoot, srcDir!, filename!))).toBe(true);
  });

  it('waits for the page rather than activating under a live session', () => {
    // `prompt`, not `autoUpdate`: an activation mid-session leaves the loaded
    // page requesting asset filenames the new revision has rotated away, and
    // `autoUpdate`'s reload discards every unsaved form in the app. The UI half
    // that makes `prompt` reach the user is `components/pwa/UpdatePrompt.tsx`.
    expect(buildServiceWorkerOptions().registerType).toBe('prompt');
  });

  it('leaves registration to the React tree', () => {
    // `null`, not `'auto'` (issue #219). With `'auto'` the plugin injects its
    // own `registerSW.js`, so the worker is registered a second time from a
    // script `useRegisterSW` cannot observe — and the update prompt then
    // reports on a registration that is not the live one.
    expect(buildServiceWorkerOptions().injectRegister).toBeNull();
  });

  it('serves the manifest and the worker from the dev server too', () => {
    // Without this, `sw.ts` is only ever exercised by a production build, and
    // DevTools' Application panel is blank against `npm run dev`.
    const { devOptions } = buildServiceWorkerOptions();

    expect(devOptions?.enabled).toBe(true);
    // ESM in dev: the un-bundled worker keeps its `workbox-*` imports, which a
    // classic worker cannot load.
    expect(devOptions?.type).toBe('module');
    // Without a dev navigateFallback the injection point becomes `[]` and
    // `createHandlerBoundToURL('/index.html')` throws `non-precached-url` on
    // activation — in dev only.
    expect(devOptions?.navigateFallback).toBe('index.html');
  });
});

describe('src/sw.ts', () => {
  const source = readFileSync(resolve(webRoot, 'src', 'sw.ts'), 'utf-8');

  it('denylists /api on the navigation route', () => {
    // Read the source rather than the bundle: the point is that the rule is
    // written down where a reviewer edits it. `/api/notifications/stream` is
    // Server-Sent Events — a response that never ends — so a worker that
    // handled it would hold a fetch open until the browser killed it.
    expect(source).toMatch(/denylist:\s*\[\s*\/\^\\\/api\\\/\//);
  });

  it('exposes the SKIP_WAITING handshake issue #219 will call', () => {
    // Under `registerType: 'prompt'` a worker with no listener here can never
    // be told to activate, so it sits in `waiting` forever and users never
    // receive an update.
    expect(source).toMatch(/'SKIP_WAITING'/);
  });

  it('never calls the API', () => {
    // The access token is memory-only and the refresh cookie is one-shot and
    // rotated, so a worker that fetched `/api` would spend the page's refresh
    // token and log the user out. There is no legitimate reason for this file
    // to name an API path outside a comment.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(^|[^:])\/\/.*$/gm, '$1');

    expect(code).not.toMatch(/fetch\s*\(/);
    expect(code).not.toMatch(/['"`]\/api\//);
  });
});

describe('sw.ts notificationclick handler', () => {
  let notificationClickHandler: (event: {
    notification: { close: () => void; data: unknown };
    waitUntil: (promise: Promise<unknown>) => void;
  }) => void;
  let clientsMatchAll: ReturnType<typeof vi.fn>;
  let clientsOpenWindow: ReturnType<typeof vi.fn>;

  beforeAll(async () => {
    clientsMatchAll = vi.fn();
    clientsOpenWindow = vi.fn();

    // `self` in jsdom IS `window`/`globalThis` — these are the two properties
    // `sw.ts` reaches for beyond what workbox already covers (mocked above).
    (self as unknown as { __WB_MANIFEST: unknown }).__WB_MANIFEST = [];
    (self as unknown as { clients: unknown }).clients = {
      matchAll: clientsMatchAll,
      openWindow: clientsOpenWindow,
    };

    // Captures the real listener functions `sw.ts` registers at import time,
    // rather than trying to `dispatchEvent` a `notificationclick` — jsdom has
    // no such event, and the handler needs `.notification`/`.waitUntil`,
    // neither of which a real Event carries.
    const addEventListenerSpy = vi.spyOn(self, 'addEventListener');

    await import('../../sw');

    const call = addEventListenerSpy.mock.calls.find(([type]) => type === 'notificationclick');
    if (!call) {
      throw new Error('sw.ts did not register a notificationclick listener');
    }
    notificationClickHandler = call[1] as typeof notificationClickHandler;

    addEventListenerSpy.mockRestore();
  });

  beforeEach(() => {
    clientsMatchAll.mockReset();
    clientsOpenWindow.mockReset();
  });

  function fireAndAwait(data: unknown) {
    const close = vi.fn();
    let waited: Promise<unknown> = Promise.resolve();
    const event = {
      notification: { close, data },
      waitUntil: (promise: Promise<unknown>) => {
        waited = promise;
      },
    };

    notificationClickHandler(event);
    return { close, settled: waited.catch(() => undefined) };
  }

  it('focuses a matching open window client and postMessages the click, without opening a new window', async () => {
    const matching = {
      url: 'http://localhost:3000/notifications',
      focus: vi.fn().mockResolvedValue(undefined),
      postMessage: vi.fn(),
    };
    const other = {
      url: 'http://localhost:3000/settings',
      focus: vi.fn().mockResolvedValue(undefined),
      postMessage: vi.fn(),
    };
    clientsMatchAll.mockResolvedValue([other, matching]);

    const { close, settled } = fireAndAwait({ id: 'notif-1', link: '/notifications' });
    await settled;

    expect(close).toHaveBeenCalledTimes(1);
    expect(clientsMatchAll).toHaveBeenCalledWith({ type: 'window', includeUncontrolled: true });
    expect(matching.focus).toHaveBeenCalledTimes(1);
    expect(matching.postMessage).toHaveBeenCalledWith({
      type: 'notification-click',
      id: 'notif-1',
      link: '/notifications',
    });
    expect(other.focus).not.toHaveBeenCalled();
    expect(other.postMessage).not.toHaveBeenCalled();
    expect(clientsOpenWindow).not.toHaveBeenCalled();
  });

  it('falls back to the first open client when none matches the link path', async () => {
    const first = {
      url: 'http://localhost:3000/settings',
      focus: vi.fn().mockResolvedValue(undefined),
      postMessage: vi.fn(),
    };
    const second = {
      url: 'http://localhost:3000/admin',
      focus: vi.fn().mockResolvedValue(undefined),
      postMessage: vi.fn(),
    };
    clientsMatchAll.mockResolvedValue([first, second]);

    const { settled } = fireAndAwait({ id: 'notif-2', link: '/notifications' });
    await settled;

    expect(first.focus).toHaveBeenCalledTimes(1);
    expect(first.postMessage).toHaveBeenCalledWith({
      type: 'notification-click',
      id: 'notif-2',
      link: '/notifications',
    });
    expect(second.focus).not.toHaveBeenCalled();
    expect(clientsOpenWindow).not.toHaveBeenCalled();
  });

  it('opens a new window with ?n=<id> appended when no window client is open (link has no query)', async () => {
    clientsMatchAll.mockResolvedValue([]);

    const { close, settled } = fireAndAwait({ id: 'notif-3', link: '/notifications' });
    await settled;

    expect(close).toHaveBeenCalledTimes(1);
    expect(clientsOpenWindow).toHaveBeenCalledWith('/notifications?n=notif-3');
  });

  it('opens a new window with &n=<id> appended when the link already carries a query string', async () => {
    clientsMatchAll.mockResolvedValue([]);

    const { settled } = fireAndAwait({ id: 'notif-4', link: '/notifications?tab=unread' });
    await settled;

    expect(clientsOpenWindow).toHaveBeenCalledWith('/notifications?tab=unread&n=notif-4');
  });

  it('URL-encodes the id in the cold-open query string', async () => {
    clientsMatchAll.mockResolvedValue([]);

    const { settled } = fireAndAwait({ id: 'id with spaces', link: '/notifications' });
    await settled;

    expect(clientsOpenWindow).toHaveBeenCalledWith(
      `/notifications?n=${encodeURIComponent('id with spaces')}`,
    );
  });

  it('rejects an off-origin link (absolute URL) and falls back to "/" rather than trusting it', async () => {
    clientsMatchAll.mockResolvedValue([]);

    const { settled } = fireAndAwait({ id: 'notif-5', link: 'https://evil.example.com/phish' });
    await settled;

    expect(clientsOpenWindow).toHaveBeenCalledWith('/?n=notif-5');
    expect(clientsOpenWindow).not.toHaveBeenCalledWith(
      expect.stringContaining('evil.example.com'),
    );
  });

  it('rejects a protocol-relative link ("//host") and falls back to "/" rather than trusting it', async () => {
    const client = {
      url: 'http://localhost:3000/',
      focus: vi.fn().mockResolvedValue(undefined),
      postMessage: vi.fn(),
    };
    clientsMatchAll.mockResolvedValue([client]);

    const { settled } = fireAndAwait({ id: 'notif-6', link: '//evil.example.com' });
    await settled;

    expect(client.postMessage).toHaveBeenCalledWith({
      type: 'notification-click',
      id: 'notif-6',
      link: '/',
    });
  });

  it('does not throw when notification.data is missing', async () => {
    clientsMatchAll.mockResolvedValue([]);

    const { close, settled } = fireAndAwait(undefined);
    await expect(settled).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
    expect(clientsOpenWindow).toHaveBeenCalledWith('/?n=');
  });

  it('does not throw when notification.data is malformed (wrong shape)', async () => {
    clientsMatchAll.mockResolvedValue([]);

    const { close, settled } = fireAndAwait({ id: 42, link: { not: 'a string' } });
    await expect(settled).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
    // Non-string `id`/`link` are defensively coerced away rather than passed
    // through: id becomes '', link falls back to '/'.
    expect(clientsOpenWindow).toHaveBeenCalledWith('/?n=');
  });

  it('does not throw when notification.data is null', async () => {
    clientsMatchAll.mockResolvedValue([]);

    const { close, settled } = fireAndAwait(null);
    await expect(settled).resolves.toBeUndefined();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
