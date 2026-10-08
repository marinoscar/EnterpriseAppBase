/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

/** The identity fields the page shell and the manifest show (packages/shared/identity.json). */
export interface WebIdentity {
  productName: string;
  themeColor: string;
  backgroundColor: string;
}

// `import.meta.dirname` when Vite loads this file; the workspace directory under a jsdom test.
const HERE = typeof import.meta.dirname === 'string' ? import.meta.dirname : process.cwd();
const IDENTITY_PATH = join(HERE, '..', '..', 'packages', 'shared', 'identity.json');

export function readIdentity(path = IDENTITY_PATH): WebIdentity {
  return JSON.parse(readFileSync(path, 'utf8')) as WebIdentity;
}

/** `index.html` with the identity in its `<title>` and theme colour. */
export function renderIndexHtml(html: string, identity: WebIdentity): string {
  const escape = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  return html.replaceAll('%APP_NAME%', escape(identity.productName)).replaceAll('%APP_THEME_COLOR%', identity.themeColor);
}

/** The web app manifest, from the same identity. */
export function renderManifest(identity: WebIdentity): string {
  const manifest = {
    name: identity.productName,
    short_name: identity.productName,
    start_url: '/',
    display: 'standalone',
    theme_color: identity.themeColor,
    background_color: identity.backgroundColor,
    icons: [{ src: '/favicon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

/** Renders the shell and serves/emits the manifest, so a rename touches identity.json only. */
function identityPlugin(): Plugin {
  return {
    name: 'app-identity',
    transformIndexHtml: (html) => renderIndexHtml(html, readIdentity()),
    configureServer(server) {
      server.middlewares.use('/manifest.webmanifest', (_req, res) => {
        res.setHeader('Content-Type', 'application/manifest+json');
        res.end(renderManifest(readIdentity()));
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: renderManifest(readIdentity()) });
    },
  };
}

export default defineConfig({
  plugins: [react(), identityPlugin()],
  // The packaged pages are one chunk until the app splits its routes.
  build: { chunkSizeWarningLimit: 2000 },
  server: {
    host: true,
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/__tests__/setup.ts'],
  },
});
