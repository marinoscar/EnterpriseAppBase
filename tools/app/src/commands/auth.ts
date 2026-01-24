import { Command } from 'commander';
import inquirer from 'inquirer';
import {
  loadTokens,
  clearTokens,
  getUserFromToken,
  isTokenExpired,
} from '../lib/auth-store.js';
import {
  isAppUrlConfigured,
  getAppUrl,
  getApiUrl,
  setAppUrl,
} from '../lib/config-store.js';
import { loginWithDeviceFlow } from '../lib/device-flow.js';
import { getCurrentUser } from '../lib/api-client.js';
import { validateUrl, normalizeUrl } from '../lib/validators.js';
import * as output from '../utils/output.js';

/**
 * Login using device authorization flow
 */
async function authLogin(): Promise<void> {
  // Check if App URL is configured
  if (!isAppUrlConfigured()) {
    output.warn('No App URL configured.');
    output.keyValue('Default URL', getAppUrl());
    output.blank();

    const { configure } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'configure',
        message: 'Would you like to configure the App URL first?',
        default: false,
      },
    ]);

    if (configure) {
      const { url } = await inquirer.prompt([
        {
          type: 'input',
          name: 'url',
          message: 'Enter App URL (e.g., https://myapp.com):',
          default: getAppUrl(),
          validate: validateUrl,
        },
      ]);

      const normalized = normalizeUrl(url);
      setAppUrl(normalized);
      output.success(`App URL set to: ${normalized}`);
      output.dim(`API URL will be: ${normalized}/api`);
      output.blank();
    }
  }

  // Check if already logged in
  const existingTokens = loadTokens();
  if (existingTokens && !isTokenExpired(existingTokens)) {
    const user = getUserFromToken(existingTokens);
    output.warn(`Already logged in as ${user?.email || 'unknown'}`);
    output.info('Use "app auth logout" first to login with a different account.');
    return;
  }

  output.dim(`Connecting to: ${getApiUrl()}`);

  try {
    const tokens = await loginWithDeviceFlow();
    const user = getUserFromToken(tokens);

    output.blank();
    output.success(`Successfully authenticated as ${user?.email || 'unknown'}`);

    if (user?.roles?.length) {
      output.info(`Roles: ${user.roles.join(', ')}`);
    }
  } catch (error) {
    output.error(`Login failed: ${(error as Error).message}`);
    throw error; // Re-throw for CLI handler to catch
  }
}

/**
 * Logout and clear stored credentials
 */
async function authLogout(): Promise<void> {
  const tokens = loadTokens();

  if (!tokens) {
    output.info('Not logged in.');
    return;
  }

  clearTokens();
  output.success('Logged out successfully.');
}

/**
 * Show authentication status
 */
async function authStatus(): Promise<void> {
  const tokens = loadTokens();

  if (!tokens) {
    output.info('Not authenticated.');
    output.info('Run "app auth login" to authenticate.');
    return;
  }

  const user = getUserFromToken(tokens);
  const expired = isTokenExpired(tokens);

  output.header('Authentication Status');
  output.blank();

  if (expired) {
    output.warn('Status: Token expired (will refresh on next request)');
  } else {
    output.success('Status: Authenticated');
  }

  if (user) {
    output.keyValue('Email', user.email);
    output.keyValue('Roles', user.roles.join(', '));
  }

  const expiresAt = new Date(tokens.expiresAt);
  output.keyValue('Token expires', expiresAt.toLocaleString());
}

/**
 * Show current user info from API
 */
async function authWhoami(): Promise<void> {
  const user = await getCurrentUser();
  output.blank();
  console.log(JSON.stringify(user, null, 2));
}

/**
 * Print current access token (for debugging)
 */
async function authToken(): Promise<void> {
  const tokens = loadTokens();

  if (!tokens) {
    throw new Error('Not authenticated.');
  }

  // Print just the token for easy piping
  console.log(tokens.accessToken);
}

/**
 * Wrapper for CLI commands to handle errors and exit
 */
function cliAction(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn();
    } catch (error) {
      output.error((error as Error).message);
      process.exit(1);
    }
  };
}

/**
 * Register auth commands with Commander
 */
export function registerAuthCommands(program: Command): void {
  const authCmd = program
    .command('auth')
    .description('Authentication commands');

  authCmd
    .command('login')
    .description('Authenticate via device authorization flow')
    .action(cliAction(authLogin));

  authCmd
    .command('logout')
    .description('Clear stored credentials')
    .action(cliAction(authLogout));

  authCmd
    .command('status')
    .description('Show current authentication status')
    .action(cliAction(authStatus));

  authCmd
    .command('whoami')
    .description('Show current user info from API')
    .action(cliAction(authWhoami));

  authCmd
    .command('token')
    .description('Print current access token (for debugging/scripts)')
    .action(cliAction(authToken));
}

// Export for interactive mode
export { authLogin, authLogout, authStatus, authWhoami, authToken };
