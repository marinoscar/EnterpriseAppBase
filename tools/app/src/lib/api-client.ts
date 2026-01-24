import { config } from '../utils/config.js';
import {
  AuthTokens,
  loadTokens,
  saveTokens,
  isTokenExpired,
} from './auth-store.js';
import { refreshAccessToken } from './device-flow.js';

/**
 * API request options
 */
export interface ApiRequestOptions extends RequestInit {
  requireAuth?: boolean;
}

/**
 * Ensure we have valid tokens, refreshing if necessary
 */
async function ensureValidTokens(): Promise<AuthTokens> {
  const tokens = loadTokens();

  if (!tokens) {
    throw new Error('Not authenticated. Run: app auth login');
  }

  if (isTokenExpired(tokens)) {
    // Try to refresh the token
    try {
      return await refreshAccessToken(tokens.refreshToken);
    } catch {
      throw new Error('Session expired. Please login again: app auth login');
    }
  }

  return tokens;
}

/**
 * Make an authenticated API request
 */
export async function apiRequest(
  path: string,
  options: ApiRequestOptions = {}
): Promise<Response> {
  const { requireAuth = true, ...fetchOptions } = options;

  const url = `${config.apiUrl}${path}`;
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (requireAuth) {
    const tokens = await ensureValidTokens();
    headers['Authorization'] = `Bearer ${tokens.accessToken}`;
  }

  const response = await fetch(url, {
    ...fetchOptions,
    headers,
  });

  // Handle 401 errors
  if (response.status === 401 && requireAuth) {
    throw new Error('Session expired. Please login again: app auth login');
  }

  return response;
}

interface UserResponse {
  data: {
    id: string;
    email: string;
    displayName: string;
    roles: string[];
  };
}

/**
 * Get current user info from /api/auth/me
 */
export async function getCurrentUser(): Promise<{
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}> {
  const response = await apiRequest('/auth/me');

  if (!response.ok) {
    throw new Error('Failed to get user info');
  }

  const result = (await response.json()) as UserResponse;
  return result.data;
}

/**
 * Check if the API is healthy
 */
export async function checkHealth(): Promise<{
  live: boolean;
  ready: boolean;
}> {
  try {
    const liveResponse = await fetch(`${config.apiUrl}/health/live`, {
      method: 'GET',
    });

    const readyResponse = await fetch(`${config.apiUrl}/health/ready`, {
      method: 'GET',
    });

    return {
      live: liveResponse.ok,
      ready: readyResponse.ok,
    };
  } catch {
    return {
      live: false,
      ready: false,
    };
  }
}
