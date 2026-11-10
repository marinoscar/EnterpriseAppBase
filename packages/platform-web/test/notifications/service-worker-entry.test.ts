// The `@marinoscar/platform-web/notifications/service-worker` entry (#886).
// In Vite dev mode nothing is tree-shaken, so every module the worker's entry
// reaches is loaded into the worker, where React Refresh throws
// "window is not defined". The entry's import graph must therefore hold no
// React, router, MUI or Vite module, and importing it must not touch a DOM
// global.
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const entry = resolve(here, '../../src/notifications/headless/service-worker.ts');

const FORBIDDEN = /^(react($|\/)|react-dom|react-router|@mui\/|@emotion\/|@vite\/|vite($|\/)|@vitejs\/|@react-refresh)/;

function specifiers(source: string): string[] {
  const out: string[] = [];
  const re = /(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const m of source.matchAll(re)) out.push((m[1] ?? m[2] ?? m[3])!);
  return out;
}

function graph(file: string, seen = new Set<string>()): Set<string> {
  if (seen.has(file)) return seen;
  seen.add(file);
  for (const spec of specifiers(readFileSync(file, 'utf8'))) {
    if (spec.startsWith('.')) {
      graph(resolve(dirname(file), spec.replace(/\.js$/, '.ts')), seen);
    } else {
      seen.add(spec);
    }
  }
  return seen;
}

describe('notifications/service-worker entry', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('reaches no react, router, MUI or vite module', () => {
    const modules = [...graph(entry)];
    expect(modules.length).toBeGreaterThan(1);
    expect(modules.filter((m) => FORBIDDEN.test(m))).toEqual([]);
    expect(modules.filter((m) => m.endsWith('.tsx'))).toEqual([]);
  });

  it('is exported from package.json at its own path', () => {
    const pkg = JSON.parse(readFileSync(resolve(here, '../../package.json'), 'utf8'));
    expect(pkg.exports['./notifications/service-worker'].default).toBe('./dist/notifications/headless/service-worker.js');
  });

  it('imports without window or document', async () => {
    vi.resetModules();
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    const mod = await import('../../src/notifications/headless/service-worker.js');
    expect(typeof mod.registerNotificationServiceWorkerHandlers).toBe('function');
  });
});
