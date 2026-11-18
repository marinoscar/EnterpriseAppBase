/**
 * The About page's extra sections (PP-14.13): one section per group the app
 * contributed with `registerAboutContributor`, after the platform's own, and
 * nothing at all when there are none (the DOM is pinned by
 * `about-page.dom.test.tsx`).
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { screen, within } from '@testing-library/react';
import { AboutPage } from '../../src/host/ui/index.js';
import type { AboutResponse } from '../../src/host/headless/index.js';
import { mockAdminUser, render, reset, serve } from './render.js';

const ABOUT: AboutResponse = {
  api: { version: '2.4.1', deploymentMode: 'byoc' },
  deployInfoStatus: 'absent',
  deployInfoPath: '/srv/app/deploy/info.json',
  deployInfoError: null,
  app: null,
  installedAt: null,
  updatedAt: null,
  deployedBy: null,
  domain: null,
  remote: null,
  run: null,
  database: { status: 'up', responseTime: '4ms' },
  databaseError: null,
};

beforeEach(() => {
  reset();
});

describe('AboutPage extras', () => {
  it('renders each contributed group as its own section, in order, after the database', async () => {
    serve('GET', '/admin/about', {
      ...ABOUT,
      extras: [
        { id: 'transcription', label: 'Transcription', facts: { provider: 'example-transcribe', models: 2, batchOnly: true } },
        { id: 'flags', label: 'Feature flags', facts: { enabled: 'a,b' } },
      ],
    });
    render(<AboutPage />, { wrapperOptions: { user: mockAdminUser } });

    const facts = await screen.findByTestId('about-extra-transcription');
    expect(within(facts).getByText('provider')).toBeInTheDocument();
    expect(within(facts).getByText('example-transcribe')).toBeInTheDocument();
    expect(within(facts).getByText('models')).toBeInTheDocument();
    expect(within(facts).getByText('2')).toBeInTheDocument();
    expect(within(facts).getByText('true')).toBeInTheDocument();
    expect(within(screen.getByTestId('about-extra-flags')).getByText('a,b')).toBeInTheDocument();

    const headings = screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent);
    expect(headings.slice(-3)).toEqual(['Database', 'Transcription', 'Feature flags']);
  });

  it('shows an app deployment mode the platform does not know', async () => {
    serve('GET', '/admin/about', ABOUT);
    render(<AboutPage />, { wrapperOptions: { user: mockAdminUser } });
    expect(within(await screen.findByTestId('about-api-facts')).getByText('byoc')).toBeInTheDocument();
  });

  it('renders no extra section for an empty or absent extras', async () => {
    serve('GET', '/admin/about', { ...ABOUT, extras: [] });
    render(<AboutPage />, { wrapperOptions: { user: mockAdminUser } });
    await screen.findByTestId('about-api-facts');
    expect(screen.queryByTestId(/^about-extra-/)).not.toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'This API process',
      'Database',
    ]);
  });

  it('says so when a group has no facts, and survives a malformed group', async () => {
    serve('GET', '/admin/about', {
      ...ABOUT,
      extras: [
        { id: 'empty', label: 'Empty group', facts: {} },
        { id: 'broken', label: 'Broken group', facts: null as never },
      ],
    });
    render(<AboutPage />, { wrapperOptions: { user: mockAdminUser } });
    expect(await screen.findByTestId('about-extra-empty-empty')).toHaveTextContent('Nothing to report.');
    expect(screen.getByTestId('about-extra-broken-empty')).toBeInTheDocument();
  });
});
