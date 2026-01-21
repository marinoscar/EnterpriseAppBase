import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithProviders } from './utils/test-utils';
import App from '../App';

describe('App', () => {
  it('renders home page when authenticated', async () => {
    renderWithProviders(<App />, {
      wrapperOptions: { authenticated: true },
    });

    // Wait for lazy loaded component to render
    await waitFor(() => {
      expect(screen.getByText(/Home Page/i)).toBeInTheDocument();
    });
  });

  it('renders login page when not authenticated', async () => {
    renderWithProviders(<App />, {
      wrapperOptions: { authenticated: false },
    });

    // Wait for lazy loaded component to render
    await waitFor(() => {
      expect(screen.getByText(/Sign in with/i)).toBeInTheDocument();
    });
  });
});
