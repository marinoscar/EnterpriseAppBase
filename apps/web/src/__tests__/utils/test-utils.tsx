import { ReactElement, ReactNode } from 'react';
import { render, RenderOptions, RenderResult } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { CssBaseline } from '@mui/material';
import { vi } from 'vitest';

// Mock the API module to prevent network calls
vi.mock('../../services/api', () => ({
  api: {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    setAccessToken: vi.fn(),
    refreshToken: vi.fn(),
  },
  ApiError: class ApiError extends Error {
    status: number;
    code?: string;
    details?: any;
    constructor(message: string, status: number, code?: string, details?: any) {
      super(message);
      this.status = status;
      this.code = code;
      this.details = details;
    }
  },
}));

// Import AuthContext and ThemeContextProvider after mocking
import { AuthContext } from '../../contexts/AuthContext';
import { ThemeContextProvider } from '../../contexts/ThemeContext';
import type { AuthProvider as AuthProviderType } from '../../types';

interface WrapperOptions {
  route?: string;
  theme?: 'light' | 'dark';
  authenticated?: boolean;
  user?: MockUser | null;
  isLoading?: boolean;
  providers?: AuthProviderType[];
}

export interface MockUser {
  id: string;
  email: string;
  displayName: string | null;
  profileImageUrl: string | null;
  roles: string[];
  permissions: string[];
  isActive: boolean;
  createdAt: string;
}

export const mockUser: MockUser = {
  id: 'test-user-id',
  email: 'test@example.com',
  displayName: 'Test User',
  profileImageUrl: null,
  roles: ['viewer'],
  permissions: ['user_settings:read', 'user_settings:write'],
  isActive: true,
  createdAt: new Date().toISOString(),
};

export const mockAdminUser: MockUser = {
  id: 'admin-user-id',
  email: 'admin@example.com',
  displayName: 'Admin User',
  profileImageUrl: null,
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
  createdAt: new Date().toISOString(),
};

// Default mock providers
const defaultMockProviders: AuthProviderType[] = [
  { name: 'google', authUrl: '/api/auth/google' },
];

// Mock Auth Provider for testing
interface MockAuthProviderProps {
  children: ReactNode;
  authenticated?: boolean;
  user?: MockUser | null;
  isLoading?: boolean;
  providers?: AuthProviderType[];
}

function MockAuthProvider({
  children,
  authenticated = true,
  user = mockUser,
  isLoading = false,
  providers = defaultMockProviders,
}: MockAuthProviderProps) {
  const contextValue = {
    user: authenticated ? user : null,
    isLoading,
    isAuthenticated: authenticated,
    providers,
    login: vi.fn(),
    logout: vi.fn().mockResolvedValue(undefined),
    refreshUser: vi.fn().mockResolvedValue(undefined),
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
    authenticated = true,
    user = mockUser,
    isLoading = false,
    providers = defaultMockProviders,
  } = options;

  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MemoryRouter initialEntries={[route]}>
        <ThemeContextProvider>
          <CssBaseline />
          <MockAuthProvider
            authenticated={authenticated}
            user={user}
            isLoading={isLoading}
            providers={providers}
          >
            {children}
          </MockAuthProvider>
        </ThemeContextProvider>
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
