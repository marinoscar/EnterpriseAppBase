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

  // Try to open browser
  try {
    const open = await import('open');
    await open.default(codeData.verificationUriComplete);
  } catch {
    output.warn('Could not open browser automatically.');
    output.info(`Please visit: ${codeData.verificationUriComplete}`);
  }

  // Step 3: Poll for authorization
  output.info('Waiting for authorization...');

  let pollInterval = codeData.interval * 1000;
  const deadline = Date.now() + codeData.expiresIn * 1000;

  while (Date.now() < deadline) {
    await sleep(pollInterval);

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

      return tokens;
    }

    // Handle error responses
    const errorData = (await tokenResponse.json()) as ErrorResponse;
    const errorCode = errorData.error || '';

    switch (errorCode) {
      case 'authorization_pending':
        // User hasn't approved yet, continue polling
        process.stdout.write('.');
        continue;

      case 'slow_down':
        // Polling too fast, increase interval
        pollInterval += 5000;
        continue;

      case 'expired_token':
        throw new Error('Authorization code expired. Please try again.');

      case 'access_denied':
        throw new Error('Authorization was denied.');

      default:
        throw new Error(errorData.message || 'Authorization failed');
    }
  }

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
