// The Access Tokens page (moved from the reference app's UserSettingsPages
// suite, issue #727): thin wiring around PersonalAccessTokens.

import { screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { UserTokensPage } from '../../src/identity/ui/index.js';
import { render } from './render.js';

vi.mock('../../src/identity/ui/tokens/PersonalAccessTokens.js', () => ({
  PersonalAccessTokens: vi.fn(() => <div data-testid="personal-access-tokens" />),
}));

describe('UserTokensPage', () => {
  it('displays its title and description', () => {
    render(<UserTokensPage />);
    expect(screen.getByRole('heading', { name: /access tokens/i })).toBeInTheDocument();
    expect(screen.getByText(/create and revoke personal access tokens/i)).toBeInTheDocument();
  });

  it('renders PersonalAccessTokens', () => {
    render(<UserTokensPage />);
    expect(screen.getByTestId('personal-access-tokens')).toBeInTheDocument();
  });
});
