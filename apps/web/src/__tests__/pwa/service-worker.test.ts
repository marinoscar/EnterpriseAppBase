import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'vite';
import { buildServiceWorkerOptions } from '../../../pwa/service-worker';

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
