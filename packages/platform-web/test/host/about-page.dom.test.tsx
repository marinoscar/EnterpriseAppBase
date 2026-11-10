/**
 * The About page's DOM is a contract: a page rendered with no `extras` is byte-for-byte
 * what it was before the report could carry extras (the packaged-page rule that an unused
 * extension point never moves the DOM or the visual baselines). The snapshot was recorded
 * from the page before the extras section existed.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { AboutPage } from '../../src/host/ui/index.js';
import type { AboutResponse } from '../../src/host/headless/index.js';
import { mockAdminUser, render, reset, serve } from './render.js';

const ABOUT: AboutResponse = {
  api: { version: '2.4.1', deploymentMode: 'self-hosted' },
  deployInfoStatus: 'ok',
  deployInfoPath: '/srv/app/deploy/info.json',
  deployInfoError: null,
  app: { name: 'Example App', version: '2.4.1', commitSha: '4f21ab9c33de7715b0a1d2e3f4a5b6c7d8e9f001', ref: 'main' },
  installedAt: '2026-01-04T09:12:00.000Z',
  updatedAt: '2026-08-30T18:40:00.000Z',
  deployedBy: { cli: 'appctl', version: '1.9.0' },
  domain: 'app.example.com',
  remote: { commitsBehind: 3, checkedAt: '2026-08-30T18:39:00.000Z' },
  run: { completed: ['pull', 'build', 'migrate', 'restart'], failedStep: null, outcome: 'success' },
  runtime: { processStartedAt: '2026-09-01T08:00:00.000Z', nodeVersion: 'v24.0.0', environment: 'production' },
  database: { status: 'up', responseTime: '4ms' },
  databaseError: null,
};

beforeEach(() => {
  reset();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-09-02T12:00:00.000Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('AboutPage DOM without extras', () => {
  it('renders the same DOM it always has', async () => {
    serve('GET', '/admin/about', ABOUT);
    const { container } = render(<AboutPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByTestId('about-deployment-facts');
    expect(container.innerHTML).toMatchSnapshot();
  });

  it('is unchanged by an empty extras array', async () => {
    serve('GET', '/admin/about', { ...ABOUT, extras: [] });
    const { container } = render(<AboutPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByTestId('about-deployment-facts');
    expect(container.innerHTML).toMatchSnapshot();
  });
});
