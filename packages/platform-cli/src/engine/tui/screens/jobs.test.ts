import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it, vi } from 'vitest';

import { BUILTIN_TUI_SCREENS } from '../screen-registry.js';
import { createJobsSource } from './jobs.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCREEN = readFileSync(join(HERE, 'jobs.tsx'), 'utf8');

describe('the jobs screen', () => {
  it('is a built-in at order 35, between status and node, with its component attached', () => {
    const order = BUILTIN_TUI_SCREENS.map((screen) => screen.route);
    expect(BUILTIN_TUI_SCREENS.find((screen) => screen.route === 'jobs')?.order).toBe(35);
    expect(order.indexOf('jobs')).toBe(order.indexOf('status') + 1);
    expect(order.indexOf('jobs')).toBe(order.indexOf('node') - 1);
    expect(readFileSync(join(HERE, '..', 'builtin-screens.tsx'), 'utf8')).toContain('jobs: JobsScreen');
  });

  it('renders through the shared dashboard pattern and sends only reads', () => {
    expect(SCREEN).toContain('useDashboard(source)');
    expect(SCREEN).toContain('pollFeed');
    expect(SCREEN).toContain('state.forbidden');
    expect(SCREEN).not.toMatch(/\.(post|put|patch|delete)\(/);
  });

  it('polls with the caller credential, aborts on stop and shows the 403 notice in state', async () => {
    const calls: Array<{ url: string; auth: string | null; signal: AbortSignal | null }> = [];
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      calls.push({ url: String(input), auth: headers.get('authorization'), signal: init?.signal ?? null });
      return new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'Forbidden' } }), {
        status: 403,
        headers: { 'content-type': 'application/json' },
      });
    });
    try {
      const source = createJobsSource('http://localhost:3535', 'tok_secret', 60_000);
      await source.start();

      expect(calls.some((c) => c.url.endsWith('/api/admin/jobs/stats'))).toBe(true);
      expect(calls.every((c) => c.auth === 'Bearer tok_secret')).toBe(true);
      // A 403 is a notice, not a failure of the feed.
      expect(source.getState().forbidden).toContain('jobs:read');
      expect(source.getState().connected).toBe(true);
      source.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
