import React, { ReactElement, ReactNode, createContext } from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ThemeProvider } from '@mui/material/styles';
import { CssBaseline } from '@mui/material';
import { lightTheme, darkTheme } from '../../theme';
import { vi } from 'vitest';
import { AuthProvider as AuthProviderType } from '../../types';

// Create a mock AuthContext for testing
interface AuthContextValue {
  user: any | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  providers: AuthProviderType[];
  login: (provider: string) => void;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface WrapperOptions {
  route?: string;
  theme?: 'light' | 'dark';
  authenticated?: boolean;
  user?: MockUser | null;
}

export interface MockUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  permissions: string[];
  isActive: boolean;
}

export const mockUser: MockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  displayName: 'Test User',
  roles: ['viewer'],
  permissions: ['user_settings:read', 'user_settings:write'],
  isActive: true,
};

export const mockAdminUser: MockUser = {
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin User',
  roles: ['admin'],
  permissions: [
    'user_settings:read',
    'user_settings:write',
    'system_settings:read',
    'system_settings:write',
    'users:read',
    'users:write',
    'rbac:manage',
  ],
  isActive: true,
};

// Mock Auth Provider for testing
interface MockAuthProviderProps {
  children: ReactNode;
  authenticated?: boolean;
  user?: MockUser | null;
}

function MockAuthProvider({
  children,
  authenticated = true,
  user = mockUser,
}: MockAuthProviderProps) {
  const contextValue = {
    user: authenticated ? user : null,
    isLoading: false,
    isAuthenticated: authenticated,
    providers: [],
    login: vi.fn(),
    logout: vi.fn(),
    refreshUser: vi.fn(),
  };

  return (
    <AuthContext.Provider value={contextValue}>
      {children}
    </AuthContext.Provider>
  );
}

function createWrapper(options: WrapperOptions = {}) {
  const {
    route = '/',
    theme = 'light',
    authenticated = true,
    user = mockUser,
  } = options;

  return function Wrapper({ children }: { children: ReactNode }) {
    const selectedTheme = theme === 'light' ? lightTheme : darkTheme;

    return (
      <MemoryRouter initialEntries={[route]}>
        <ThemeProvider theme={selectedTheme}>
          <CssBaseline />
          <MockAuthProvider authenticated={authenticated} user={user}>
            {children}
          </MockAuthProvider>
        </ThemeProvider>
      </MemoryRouter>
    );
  };
}

interface CustomRenderOptions extends Omit<RenderOptions, 'wrapper'> {
  wrapperOptions?: WrapperOptions;
}

export function renderWithProviders(
  ui: ReactElement,
  options: CustomRenderOptions = {},
): RenderResult {
  const { wrapperOptions, ...renderOptions } = options;

  return render(ui, {
    wrapper: createWrapper(wrapperOptions),
    ...renderOptions,
  });
}

// Re-export everything from testing library
export * from '@testing-library/react';
export { renderWithProviders as render };
