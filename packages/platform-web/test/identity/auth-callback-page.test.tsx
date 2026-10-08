// Moved from the reference app (apps/web/src/__tests__, issue #727).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { userEvent } from '@testing-library/user-event';
import { render } from './render.js';
import { AuthCallbackPage } from '../../src/identity/ui/AuthCallbackPage.js';

// Mock useNavigate and useSearchParams
const mockNavigate = vi.fn();
const mockSearchParams = new URLSearchParams();
const mockRefreshUser = vi.fn();
const mockLogin = vi.fn();
const mockSetAccessToken = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
    useSearchParams: () => [mockSearchParams],
  };
});

// Mock useAuth hook
vi.mock('../../src/identity/headless/auth-context.js', async () => {
  const actual = await vi.importActual('../../src/identity/headless/auth-context.js');
  return {
    ...actual,
    useAuth: () => ({
      user: null,
      isLoading: false,
      isAuthenticated: false,
      providers: [],
      login: mockLogin,
      logout: vi.fn(),
      refreshUser: mockRefreshUser,
      setAccessToken: mockSetAccessToken,
    }),
  };
});

describe('AuthCallbackPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    mockSearchParams.delete('token');
    mockSearchParams.delete('error');
    // Reset mockRefreshUser to default resolved behavior
    mockRefreshUser.mockResolvedValue(undefined);
  });

  describe('Loading State', () => {
    it('should show loading spinner initially before processing', () => {
      // Mock refreshUser to delay so we can catch loading state
      mockRefreshUser.mockImplementation(() => new Promise(() => {})); // Never resolves
      mockSearchParams.set('token', 'test-token');

      render(<AuthCallbackPage />, {
        wrapperOptions: { authenticated: false },
      });

      // Should show loading immediately
      expect(screen.getByRole('progressbar')).toBeInTheDocument();
      expect(screen.getByText(/completing authentication/i)).toBeInTheDocument();
    });
  });

  describe('OAuth Callback Success', () => {
    it('should extract token from URL params and store it', async () => {
      const mockToken = 'test-access-token-123';
      mockSearchParams.set('token', mockToken);

      const setAccessTokenSpy = mockSetAccessToken;

      render(<AuthCallbackPage />, {
        wrapperOptions: {
          authenticated: false,
        },
      });

      await waitFor(() => {
        expect(setAccessTokenSpy).toHaveBeenCalledWith(mockToken);
      });
    });

    it('should call refreshUser after storing token', async () => {
      const mockToken = 'test-access-token-123';
      mockSearchParams.set('token', mockToken);
      mockRefreshUser.mockResolvedValue(undefined);

      render(<AuthCallbackPage />, {
        wrapperOptions: {
          authenticated: false,
        },
      });

      await waitFor(() => {
        expect(mockRefreshUser).toHaveBeenCalled();
      });
    });

    it('should redirect to home when no returnUrl is stored', async () => {
      const mockToken = 'test-access-token-123';
      mockSearchParams.set('token', mockToken);

      render(<AuthCallbackPage />, {
        wrapperOptions: {
          authenticated: false,
        },
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith('/', { replace: true });
      });
    });

    it('should redirect to stored returnUrl after successful auth', async () => {
      const mockToken = 'test-access-token-123';
      const returnUrl = '/settings';
      mockSearchParams.set('token', mockToken);
      sessionStorage.setItem('auth_return_url', returnUrl);

      render(<AuthCallbackPage />, {
        wrapperOptions: {
          authenticated: false,
        },
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(returnUrl, { replace: true });
      });
    });

    it('should clear returnUrl from sessionStorage after redirect', async () => {
      const mockToken = 'test-access-token-123';
      const returnUrl = '/settings';
      mockSearchParams.set('token', mockToken);
      sessionStorage.setItem('auth_return_url', returnUrl);

      render(<AuthCallbackPage />, {
        wrapperOptions: {
          authenticated: false,
        },
      });

      await waitFor(() => {
        expect(sessionStorage.getItem('auth_return_url')).toBeNull();
      });
    });
  });

  describe('Sign-in error codes (#652)', () => {
    const headlines: Array<[string, RegExp]> = [
      ['not_allowlisted', /you don't have access yet/i],
      ['account_disabled', /your account has been deactivated/i],
      ['access_denied', /sign-in was cancelled/i],
      ['authentication_failed', /we couldn't sign you in/i],
      ['server_misconfigured', /this app isn't ready for sign-in/i],
      ['no_organization', /you're not part of an organization yet/i],
    ];

    it.each(headlines)('renders the purpose-built headline for %s', async (code, headline) => {
      mockSearchParams.set('error', code);

      render(<AuthCallbackPage />, { wrapperOptions: { authenticated: false } });

      expect(
        await screen.findByRole('heading', { level: 1, name: headline }),
      ).toBeInTheDocument();
    });

    it('explains the allowlist case and offers both next steps', async () => {
      mockSearchParams.set('error', 'not_allowlisted');

      render(<AuthCallbackPage />, { wrapperOptions: { authenticated: false } });

      expect(await screen.findByText(/isn't approved to use/i)).toBeInTheDocument();
      expect(screen.getByText(/ask an administrator to add your email/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in with a different account/i })).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /back to sign in/i })).toHaveAttribute('href', '/login');
    });

    it('does not use an error alert for the allowlist case', async () => {
      mockSearchParams.set('error', 'not_allowlisted');

      render(<AuthCallbackPage />, { wrapperOptions: { authenticated: false } });

      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByRole('status')).toBeInTheDocument();
    });

    it('explains the no_organization case (multi-org tenancy, #722) calmly, with both next steps', async () => {
      mockSearchParams.set('error', 'no_organization');

      render(<AuthCallbackPage />, { wrapperOptions: { authenticated: false } });

      expect(await screen.findByText(/isn't a member of any organization/i)).toBeInTheDocument();
      expect(screen.getByText(/ask an administrator of your organization to invite you/i)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /sign in with a different account/i })).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('announces real faults as an alert', async () => {
      mockSearchParams.set('error', 'authentication_failed');

      render(<AuthCallbackPage />, { wrapperOptions: { authenticated: false } });

      expect(await screen.findByRole('alert')).toHaveTextContent(/we couldn't sign you in/i);
    });

    it('focuses the heading on mount', async () => {
      mockSearchParams.set('error', 'not_allowlisted');

      render(<AuthCallbackPage />, { wrapperOptions: { authenticated: false } });

      const heading = await screen.findByRole('heading', { level: 1 });
      await waitFor(() => expect(heading).toHaveFocus());
    });

    it('"different account" restarts Google sign-in with the account chooser', async () => {
      const user = userEvent.setup();
      mockSearchParams.set('error', 'not_allowlisted');

      render(<AuthCallbackPage />, { wrapperOptions: { authenticated: false } });

      await user.click(
        await screen.findByRole('button', { name: /sign in with a different account/i }),
      );

      expect(mockLogin).toHaveBeenCalledWith('google', { selectAccount: true });
    });

    it('"Try again" restarts Google sign-in without the chooser', async () => {
      const user = userEvent.setup();
      mockSearchParams.set('error', 'access_denied');

      render(<AuthCallbackPage />, { wrapperOptions: { authenticated: false } });

      await user.click(await screen.findByRole('button', { name: /try again/i }));

      expect(mockLogin).toHaveBeenCalledWith('google');
    });

    it('offers no retry for a misconfigured server, only the way back', async () => {
      mockSearchParams.set('error', 'server_misconfigured');

      render(<AuthCallbackPage />, { wrapperOptions: { authenticated: false } });

      await screen.findByRole('heading', { level: 1 });
      expect(screen.queryByRole('button', { name: /try again|different account/i })).not.toBeInTheDocument();
      expect(screen.getByRole('link', { name: /back to sign in/i })).toBeInTheDocument();
    });

    it.each([
      '<script>call 555-0100</script>',
      'User not authorized to access this application',
      'Invalid OAuth state',
      'NOT_ALLOWLISTED',
    ])('never renders an unknown error value (%s); shows the generic copy', async (value) => {
      mockSearchParams.set('error', value);

      const { container } = render(<AuthCallbackPage />, {
        wrapperOptions: { authenticated: false },
      });

      expect(
        await screen.findByRole('heading', { level: 1, name: /we couldn't sign you in/i }),
      ).toBeInTheDocument();
      expect(container.textContent).not.toContain(value);
      expect(container.innerHTML).not.toContain('555-0100');
    });
  });

  describe('Error Handling', () => {
    it('shows the generic failure when no token is received', async () => {
      // No token or error in URL params
      render(<AuthCallbackPage />, {
        wrapperOptions: { authenticated: false },
      });

      expect(
        await screen.findByRole('heading', { name: /we couldn't sign you in/i }),
      ).toBeInTheDocument();
    });

    it('shows the generic failure when refreshUser fails', async () => {
      mockSearchParams.set('token', 'test-access-token-123');
      mockRefreshUser.mockRejectedValue(new Error('Network error'));

      render(<AuthCallbackPage />, {
        wrapperOptions: {
          authenticated: false,
        },
      });

      expect(
        await screen.findByRole('heading', { name: /we couldn't sign you in/i }),
      ).toBeInTheDocument();
    });

    it('should clear access token on refreshUser failure', async () => {
      const mockToken = 'test-access-token-123';
      mockSearchParams.set('token', mockToken);
      mockRefreshUser.mockRejectedValue(new Error('Network error'));
      const setAccessTokenSpy = mockSetAccessToken;

      render(<AuthCallbackPage />, {
        wrapperOptions: {
          authenticated: false,
        },
      });

      await waitFor(() => {
        // Should be called twice: once with token, once with null after failure
        expect(setAccessTokenSpy).toHaveBeenCalledWith(null);
      });
    });

    it('should not store a token when an error code is present', async () => {
      mockSearchParams.set('error', 'access_denied');
      mockSearchParams.set('token', 'some-token');
      const setAccessTokenSpy = mockSetAccessToken;

      render(<AuthCallbackPage />, {
        wrapperOptions: { authenticated: false },
      });

      await screen.findByRole('heading', { name: /sign-in was cancelled/i });
      expect(setAccessTokenSpy).not.toHaveBeenCalled();
    });
  });

  describe('UI Elements', () => {
    it('should center loading spinner vertically', () => {
      // Mock refreshUser to delay so we can catch loading state
      mockRefreshUser.mockImplementation(() => new Promise(() => {})); // Never resolves
      mockSearchParams.set('token', 'test-token');

      render(<AuthCallbackPage />, {
        wrapperOptions: { authenticated: false },
      });

      const spinner = screen.getByRole('progressbar');
      expect(spinner).toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty token param', async () => {
      mockSearchParams.set('token', '');

      render(<AuthCallbackPage />, {
        wrapperOptions: { authenticated: false },
      });

      // Empty token treated as missing token: generic failure
      expect(
        await screen.findByRole('heading', { name: /we couldn't sign you in/i }),
      ).toBeInTheDocument();
    });

    it('should handle returnUrl with special characters', async () => {
      const mockToken = 'test-access-token-123';
      const returnUrl = '/search?query=test%20value&page=1';
      mockSearchParams.set('token', mockToken);
      sessionStorage.setItem('auth_return_url', returnUrl);

      render(<AuthCallbackPage />, {
        wrapperOptions: {
          authenticated: false,
        },
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(returnUrl, { replace: true });
      });
    });

    it('should use replace: true when navigating', async () => {
      const mockToken = 'test-access-token-123';
      mockSearchParams.set('token', mockToken);

      render(<AuthCallbackPage />, {
        wrapperOptions: {
          authenticated: false,
        },
      });

      await waitFor(() => {
        expect(mockNavigate).toHaveBeenCalledWith(
          expect.any(String),
          expect.objectContaining({ replace: true })
        );
      });
    });
  });
});
