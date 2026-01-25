import { config } from '../utils/config.js';
import { sleep } from '../utils/exec.js';
import * as output from '../utils/output.js';
import { AuthTokens, saveTokens } from './auth-store.js';

/**
 * Device code response from the API
 */
interface DeviceCodeResponse {
  data: {
    deviceCode: string;
    userCode: string;
    verificationUri: string;
    verificationUriComplete: string;
    expiresIn: number;
    interval: number;
  };
}

/**
 * Token response from the API
 */
interface TokenResponse {
  data: {
    accessToken: string;
    refreshToken: string;
    tokenType: string;
    expiresIn: number;
  };
}

/**
 * Error response from the API
 */
interface ErrorResponse {
  error?: string;
  message?: string;
}

/**
 * Perform device authorization flow
 */
export async function loginWithDeviceFlow(): Promise<AuthTokens> {
  // Step 1: Request device code
  output.info('Requesting device authorization...');

  const codeResponse = await fetch(`${config.apiUrl}/auth/device/code`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      clientInfo: {
        deviceName: 'EnterpriseAppBase CLI',
        userAgent: 'app-cli/1.0.0',
      },
    }),
  });

  if (!codeResponse.ok) {
    const error = (await codeResponse.json()) as ErrorResponse;
    throw new Error(error.message || 'Failed to request device code');
  }

  const { data: codeData } = (await codeResponse.json()) as DeviceCodeResponse;

  // Step 2: Display to user and open browser
  output.blank();
  output.info(`Opening browser to: ${codeData.verificationUriComplete}`);
  output.blank();
  output.bold(`Your code: ${codeData.userCode}`);
  output.blank();
  output.dim('If the browser does not open, visit the URL above and enter the code.');
  output.blank();

  // Try to open browser - use dynamic import with better error handling
  try {
    const openModule = await import('open');
    const openFn = openModule.default;
    await openFn(codeData.verificationUriComplete);
    output.dim('Browser opened.');
  } catch (err) {
    output.warn('Could not open browser automatically.');
    output.info(`Please visit: ${codeData.verificationUriComplete}`);
  }

  // Step 3: Poll for authorization
  output.info('Waiting for authorization (this may take a few minutes)...');

  let pollInterval = (codeData.interval || 5) * 1000; // Default 5 seconds
  const expiresIn = (codeData.expiresIn || 900) * 1000; // Default 15 minutes
  const deadline = Date.now() + expiresIn;

  while (Date.now() < deadline) {
    await sleep(pollInterval);

    try {
      const tokenResponse = await fetch(`${config.apiUrl}/auth/device/token`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          deviceCode: codeData.deviceCode,
        }),
      });

      if (tokenResponse.ok) {
        const { data: tokenData } = (await tokenResponse.json()) as TokenResponse;

        // Calculate expiration timestamp
        const expiresAt = Date.now() + tokenData.expiresIn * 1000;

        const tokens: AuthTokens = {
          accessToken: tokenData.accessToken,
          refreshToken: tokenData.refreshToken,
          expiresAt,
        };

        // Save tokens
        saveTokens(tokens);
        output.blank();

        return tokens;
      }

      // Handle error responses
      let errorData: ErrorResponse;
      try {
        errorData = (await tokenResponse.json()) as ErrorResponse;
      } catch {
        // If we can't parse the error, continue polling
        process.stdout.write('.');
        continue;
      }

      const errorCode = errorData.error || '';

      switch (errorCode) {
        case 'authorization_pending':
          // User hasn't approved yet, continue polling
          process.stdout.write('.');
          continue;

        case 'slow_down':
          // Polling too fast, increase interval
          pollInterval += 5000;
          process.stdout.write('s');
          continue;

        case 'expired_token':
          throw new Error('Authorization code expired. Please try again.');

        case 'access_denied':
          throw new Error('Authorization was denied.');

        default:
          // For unknown errors, continue polling instead of failing immediately
          // The API might return different error formats
          process.stdout.write('?');
          continue;
      }
    } catch (err) {
      // Network error or other issue - continue polling
      const error = err as Error;
      if (error.message.includes('expired') || error.message.includes('denied')) {
        throw error;
      }
      process.stdout.write('!');
      continue;
    }
  }

  output.blank();
  throw new Error('Authorization timed out. Please try again.');
}

/**
 * Refresh the access token using the refresh token
 */
export async function refreshAccessToken(refreshToken: string): Promise<AuthTokens> {
  const response = await fetch(`${config.apiUrl}/auth/refresh`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refreshToken }),
  });

  if (!response.ok) {
    throw new Error('Failed to refresh token. Please login again.');
  }

  const { data } = (await response.json()) as TokenResponse;

  const expiresAt = Date.now() + data.expiresIn * 1000;

  const tokens: AuthTokens = {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt,
  };

  saveTokens(tokens);

  return tokens;
}
