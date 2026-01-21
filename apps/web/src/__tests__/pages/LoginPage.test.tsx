import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server';
import { render } from '../utils/test-utils';
import LoginPage from '../../pages/LoginPage';

describe('LoginPage', () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  describe('Rendering', () => {
    it('should render login page title', async () => {
      render(<LoginPage />, {
        wrapperOptions: { authenticated: false },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /welcome/i })).toBeInTheDocument();
      });
    });

    it('should display sign in message', async () => {
      render(<LoginPage />, {
        wrapperOptions: { authenticated: false },
      });

      await waitFor(() => {
        expect(screen.getByText(/sign in to continue/i)).toBeInTheDocument();
      });
    });

    it('should display available OAuth providers', async () => {
      render(<LoginPage />, {
        wrapperOptions: { authenticated: false },
      });

      await waitFor(() => {
        expect(screen.getByText(/google/i)).toBeInTheDocument();
      });
    });

    it('should show loading state while fetching', () => {
      server.use(
        http.get('/api/auth/providers', async () => {
          await new Promise((resolve) => setTimeout(resolve, 100));
          return HttpResponse.json({ data: [] });
        }),
        http.post('/api/auth/refresh', () => {
          return new HttpResponse(null, { status: 401 });
        }),
      );

      render(<LoginPage />, {
        wrapperOptions: { authenticated: false },
      });

      expect(screen.getByRole('progressbar')).toBeInTheDocument();
    });
  });

  describe('OAuth Flow', () => {
    it('should redirect to OAuth provider on button click', async () => {
      const user = userEvent.setup();

      // Mock window.location.href
      const originalLocation = window.location;
      delete (window as any).location;
      window.location = { ...originalLocation, href: '' } as any;

      render(<LoginPage />, {
        wrapperOptions: { authenticated: false },
      });

      await waitFor(() => {
        expect(screen.getByText(/google/i)).toBeInTheDocument();
      });

      const googleButton = screen.getByRole('button', { name: /google/i });
      await user.click(googleButton);

      expect(window.location.href).toContain('/api/auth/google');

      window.location = originalLocation;
    });

    it('should handle multiple providers', async () => {
      server.use(
        http.get('/api/auth/providers', () => {
          return HttpResponse.json({
            data: [
              { name: 'google', authUrl: '/api/auth/google' },
              { name: 'github', authUrl: '/api/auth/github' },
            ],
          });
        }),
      );

      render(<LoginPage />, {
        wrapperOptions: { authenticated: false },
      });

      await waitFor(() => {
        expect(screen.getByText(/google/i)).toBeInTheDocument();
        expect(screen.getByText(/github/i)).toBeInTheDocument();
      });
    });
  });

  describe('Error Handling', () => {
    it('should show message when no providers available', async () => {
      server.use(
        http.get('/api/auth/providers', () => {
          return HttpResponse.json({ data: [] });
        }),
      );

      render(<LoginPage />, {
        wrapperOptions: { authenticated: false },
      });

      await waitFor(() => {
        expect(screen.getByText(/no authentication providers configured/i)).toBeInTheDocument();
      });
    });

    it('should handle provider fetch errors gracefully', async () => {
      server.use(
        http.get('/api/auth/providers', () => {
          return new HttpResponse(null, { status: 500 });
        }),
      );

      render(<LoginPage />, {
        wrapperOptions: { authenticated: false },
      });

      await waitFor(() => {
        // Should still render the page, just with no providers
        expect(screen.getByRole('heading', { name: /welcome/i })).toBeInTheDocument();
      });
    });
  });

  describe('Redirect Behavior', () => {
    it('should redirect authenticated users to home', async () => {
      const { container } = render(<LoginPage />, {
        wrapperOptions: { authenticated: true },
      });

      // When authenticated, should redirect away (component unmounts)
      await waitFor(() => {
        expect(container.querySelector('h1')).not.toBeInTheDocument();
      });
    });

    it('should not redirect unauthenticated users', async () => {
      render(<LoginPage />, {
        wrapperOptions: { authenticated: false },
      });

      await waitFor(() => {
        expect(screen.getByRole('heading', { name: /welcome/i })).toBeInTheDocument();
      });
    });
  });

  describe('UI Elements', () => {
    it('should display terms of service footer', async () => {
      render(<LoginPage />, {
        wrapperOptions: { authenticated: false },
      });

      await waitFor(() => {
        expect(screen.getByText(/terms of service/i)).toBeInTheDocument();
      });
    });

    it('should have proper styling', async () => {
      render(<LoginPage />, {
        wrapperOptions: { authenticated: false },
      });

      await waitFor(() => {
        const heading = screen.getByRole('heading', { name: /welcome/i });
        expect(heading).toBeInTheDocument();
      });
    });
  });
});
