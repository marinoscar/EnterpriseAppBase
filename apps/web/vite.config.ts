import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { APP_NAME, THEME_COLOR } from '@app/shared';
import { buildManifest } from './pwa/manifest';

/**
 * Substitutes `%APP_NAME%` and `%THEME_COLOR%` in `index.html` with the
 * matching constants from `@app/shared` (issue #164, epic #161; the colour
 * token added by issue #217, epic #215).
 *
 * `index.html` is static markup: it carries the <title>, the description meta
 * and the `theme-color` meta, and it cannot import TypeScript, so it is the
 * one user-visible surface that could not simply reference the shared
 * constants. The two obvious ways to bridge that gap are both worse than a
 * four-line plugin:
 *
 *   - An env var (`VITE_APP_NAME`), which Vite would interpolate into `%...%`
 *     for free. Rejected: it makes the deployment environment a SECOND source
 *     of truth for the name. `@app/shared` exists precisely so a fork renames
 *     the product in one line; a build that also has to set an env var can
 *     silently disagree with the wordmark the React tree renders.
 *   - Setting `document.title` at runtime from `main.tsx`. Rejected: the
 *     document parses and paints with whatever the literal HTML said before
 *     any script runs, so the user gets a visible flash of the placeholder in
 *     the browser tab.
 *
 * A build-time transform has neither problem: one source of truth, resolved
 * before the HTML is ever served, so nothing at runtime is involved at all.
 * It applies in dev too (`transformIndexHtml` runs on every served request),
 * so the placeholder is never observable anywhere.
 *
 * `%THEME_COLOR%` is here for the same single-source-of-truth reason and one
 * additional one: a hardcoded hex in the <meta> would be a THIRD copy of the
 * brand colour, and the two copies that already derive it — the MUI palette's
 * `primary.main` and the manifest's `theme_color` below — are the surfaces a
 * user sees it next to. A mismatch shows up as browser chrome painted in the
 * old brand colour directly above the app painted in the new one.
 *
 * `order: 'pre'` so this runs ahead of Vite's own built-in `%ENV_VAR%` HTML
 * replacement, which would otherwise be looking at the same tokens.
 */
function appName(): Plugin {
  return {
    name: 'app-name-html',
    transformIndexHtml: {
      order: 'pre',
      handler: (html) =>
        html.replaceAll('%APP_NAME%', APP_NAME).replaceAll('%THEME_COLOR%', THEME_COLOR),
    },
  };
}

/**
 * Emits `manifest.webmanifest` from `buildManifest()` (issue #217, epic #215).
 *
 * Without a manifest the application cannot be installed, and on iOS/iPadOS
 * that is not a missing nicety — Safari grants the Notifications API only to a
 * web app that has been added to the Home Screen, so every phone and tablet in
 * that family is locked out of epic #215 entirely until this file exists and
 * declares `display: 'standalone'`.
 *
 * The manifest is BUILT, not committed, for exactly the reason the `appName()`
 * plugin above gives for the HTML. A static `public/manifest.webmanifest`
 * would hold its own copies of the name and both brand colours, so a fork that
 * renamed the product in `@app/shared` would ship an installed app whose OS
 * task-switcher label and splash screen still said the old thing — the drift
 * `@app/shared` was created to end. And the alternative bridge is the same one
 * rejected there: an env var (`VITE_APP_NAME` and friends) interpolated into a
 * committed file makes the deployment environment a second source of truth,
 * which is worse than no bridge at all because it fails silently.
 *
 * It is served in DEV as well as emitted into the build. `appName()`'s comment
 * makes the point that the placeholder must never be observable anywhere; a
 * manifest that only exists in `dist/` fails the same standard from the other
 * direction — `npm run dev` would 404 the `<link rel="manifest">`, so Chrome
 * DevTools' Application > Manifest panel (the only practical way to check
 * installability, icon rendering and maskable-icon safe zones) would be blank
 * against the server anyone actually develops on.
 *
 * NOTE FOR THE REVIEWER: issue #218 adds `vite-plugin-pwa`, at which point
 * this plugin is deleted and `buildManifest()` is passed straight to
 * `VitePWA({ manifest })` — which does both jobs. `buildManifest()` is the
 * durable half of this change and does not change then; this emitter is the
 * scaffold that keeps #217 useful on its own. Deliberately no service worker
 * and no `vite-plugin-pwa` dependency in this change.
 */
function webManifest(): Plugin {
  const FILE_NAME = 'manifest.webmanifest';
  const render = () => JSON.stringify(buildManifest(), null, 2);

  return {
    name: 'web-manifest',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: FILE_NAME, source: render() });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        // Compare the path only: the browser may append a query string, and a
        // strict `req.url === '/manifest.webmanifest'` would miss it.
        if ((req.url ?? '').split('?')[0] !== `/${FILE_NAME}`) return next();
        // `application/manifest+json` is the registered type. Chrome tolerates
        // `application/json`, but Safari — the one browser this whole epic
        // depends on — is the stricter reader, so serve the correct one.
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(render());
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), appName(), webManifest()],
  // `@app/shared` is CommonJS, and it reaches us as an npm WORKSPACE SYMLINK.
  // Vite treats a linked package as project source rather than as a dependency,
  // so it skips dep pre-bundling for it and serves `index.js` to the browser as
  // raw ESM — where `exports.APP_NAME = ...` provides no named export and the
  // module throws "does not provide an export named 'APP_NAME'", taking the
  // whole app down with a blank page.
  //
  // Listing it here forces the pre-bundle that an unlinked CommonJS dependency
  // would have got automatically, which is what converts it to ESM.
  //
  // This only bites in DEV. The production build (Rollup's commonjs plugin) and
  // the Vitest suites (their own CJS interop) both handle the same file without
  // help, which is precisely why the failure surfaces in the dev-server-backed
  // visual harness and nowhere else. See `visual/vite.config.ts`, which needs
  // the same line for the same reason.
  optimizeDeps: { include: ['@app/shared'] },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
