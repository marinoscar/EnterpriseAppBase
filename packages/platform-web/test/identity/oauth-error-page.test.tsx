// The OAuth error page (PP-15.7, #1185): the closed code list, and nothing
// echoed from the query string.

import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { OAUTH_ERROR_PAGE_CODES } from '@marinoscar/platform-contract/identity';

import { OAuthErrorPage, oauthErrorPageContent } from '../../src/identity/ui/index.js';
import { mountOAuth } from './oauth-fixtures.js';

function mountError(query: string) {
  return mountOAuth(<OAuthErrorPage />, { route: `/oauth/error${query}`, path: '/oauth/error', user: null });
}

const SENTENCES: Record<(typeof OAUTH_ERROR_PAGE_CODES)[number], RegExp> = {
  server_disabled: /Product X does not accept connections from other apps right now/,
  unknown_client: /not known to Product X/,
  client_not_allowed: /not allowed to connect to Product X. Ask an administrator to allow this app./,
  client_metadata_unavailable: /could not read the details of the app/,
  invalid_redirect_uri: /asked to return to an address it did not register/,
};

describe('OAuthErrorPage', () => {
  it.each(OAUTH_ERROR_PAGE_CODES)('has a sentence for %s', (code) => {
    mountError(`?code=${code}`);
    expect(screen.getByText(SENTENCES[code])).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveFocus();
    expect(screen.queryByText(/Something went wrong/)).not.toBeInTheDocument();
  });

  it('names the refused host for client_not_allowed', () => {
    mountError('?code=client_not_allowed&host=chat.example.test');
    expect(screen.getByText('chat.example.test is not allowed to connect to Product X. Ask an administrator to allow this app.')).toBeInTheDocument();
  });

  it('never renders a host that is not a host name', () => {
    const { container } = mountError(`?code=client_not_allowed&host=${encodeURIComponent('<img src=x onerror=alert(1)>')}`);
    expect(container.querySelector('img')).toBeNull();
    expect(container.textContent).not.toContain('onerror');
    expect(screen.getByText(/The app that sent you here is not allowed/)).toBeInTheDocument();
  });

  it('shows the generic sentence for an unknown code and never echoes it', () => {
    const { container } = mountError(`?code=${encodeURIComponent('<b>pwned</b>')}`);
    expect(screen.getByText(/Something went wrong while connecting an app to Product X/)).toBeInTheDocument();
    expect(container.textContent).not.toContain('pwned');
    expect(container.querySelector('b')).toBeNull();
  });

  it('shows the generic sentence without a code', () => {
    mountError('');
    expect(screen.getByRole('heading', { name: 'Could not connect the app' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to Product X' })).toHaveAttribute('href', '/');
  });

  it('maps every code to distinct words', () => {
    const titles = OAUTH_ERROR_PAGE_CODES.map((code) => oauthErrorPageContent(code, 'Product X', null).title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});
