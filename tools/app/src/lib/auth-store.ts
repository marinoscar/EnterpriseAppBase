import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync } from 'fs';
import { dirname } from 'path';
import { config } from '../utils/config.js';

/**
 * Stored authentication tokens
 */
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // Unix timestamp in milliseconds
}

/**
 * Save tokens to the config file
 */
export function saveTokens(tokens: AuthTokens): void {
  const dir = dirname(config.authFile);

  // Create config directory if it doesn't exist
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  // Write tokens with restricted permissions (owner read/write only)
  writeFileSync(config.authFile, JSON.stringify(tokens, null, 2), {
    mode: 0o600,
  });
}

/**
 * Load tokens from the config file
 */
export function loadTokens(): AuthTokens | null {
  try {
    if (!existsSync(config.authFile)) {
      return null;
    }

    const content = readFileSync(config.authFile, 'utf-8');
    return JSON.parse(content) as AuthTokens;
  } catch {
    return null;
  }
}

/**
 * Delete stored tokens
 */
export function clearTokens(): void {
  try {
    if (existsSync(config.authFile)) {
      unlinkSync(config.authFile);
    }
  } catch {
    // Ignore errors when clearing
  }
}

/**
 * Check if the access token is expired
 */
export function isTokenExpired(tokens: AuthTokens): boolean {
  // Add 30 second buffer to avoid edge cases
  return Date.now() >= tokens.expiresAt - 30000;
}

/**
 * Parse JWT to get payload (without verification)
 */
export function parseJwt(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) {
      return null;
    }

    const payload = Buffer.from(parts[1], 'base64').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return null;
  }
}

/**
 * Get user info from stored token
 */
export function getUserFromToken(
  tokens: AuthTokens
): { email: string; roles: string[] } | null {
  const payload = parseJwt(tokens.accessToken);

  if (!payload) {
    return null;
  }

  return {
    email: payload.email as string,
    roles: payload.roles as string[],
  };
}
