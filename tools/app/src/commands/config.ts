import { Command } from 'commander';
import inquirer from 'inquirer';
import {
  getApiUrl,
  getAppUrl,
  setAppUrl,
  clearConfig,
  getAppUrlSource,
} from '../lib/config-store.js';
import { validateUrl, normalizeUrl } from '../lib/validators.js';
import * as output from '../utils/output.js';

/**
 * Show current configuration
 */
async function configShow(): Promise<void> {
  output.header('CLI Configuration');
  output.blank();

  const appUrl = getAppUrl();
  const apiUrl = getApiUrl();
  const source = getAppUrlSource();

  output.keyValue('App URL', appUrl);
  output.keyValue('API URL', `${apiUrl} (derived)`);
  output.blank();

  switch (source) {
    case 'environment':
      output.dim('(URL from environment variable)');
      break;
    case 'config':
      output.dim('(URL from saved configuration)');
      break;
    case 'default':
      output.dim('(Using default URL - not configured)');
      break;
  }
}

/**
 * Set App URL interactively or from argument
 */
async function configSetUrl(url?: string): Promise<void> {
  let targetUrl = url;

  if (!targetUrl) {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Enter App URL (e.g., https://myapp.com):',
        default: getAppUrl(),
        validate: validateUrl,
      },
    ]);
    targetUrl = answer.url;
  }

  const normalized = normalizeUrl(targetUrl!);

  // Validate format
  const validation = validateUrl(normalized);
  if (validation !== true) {
    output.error(validation as string);
    process.exit(1);
  }

  // Test connection (optional, don't block on failure)
  const testApiUrl = `${normalized}/api`;
  output.info(`Testing connection to ${testApiUrl}...`);
  try {
    const response = await fetch(`${testApiUrl}/health/live`);
    if (response.ok) {
      output.success('Connection successful!');
    } else {
      output.warn('Server responded but health check failed. Saving URL anyway.');
    }
  } catch {
    output.warn('Could not connect to server. Saving URL anyway.');
    output.dim('(You can configure the URL now and start the server later)');
  }

  // Save the URL
  setAppUrl(normalized);

  output.blank();
  output.success(`App URL set to: ${normalized}`);
  output.dim(`API URL will be: ${normalized}/api`);
}

/**
 * Reset configuration to defaults
 */
async function configReset(): Promise<void> {
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Reset configuration to defaults?',
      default: false,
    },
  ]);

  if (!confirm) {
    output.info('Cancelled.');
    return;
  }

  clearConfig();
  output.success('Configuration reset to defaults.');
  output.blank();
  output.keyValue('App URL', getAppUrl());
  output.keyValue('API URL', getApiUrl());
}

/**
 * Register config commands with Commander
 */
export function registerConfigCommands(program: Command): void {
  const configCmd = program
    .command('config')
    .description('CLI configuration commands');

  configCmd
    .command('show')
    .description('Show current configuration')
    .action(async () => {
      await configShow();
    });

  configCmd
    .command('set-url [url]')
    .description('Set the App URL (API URL is derived automatically)')
    .action(async (url?: string) => {
      await configSetUrl(url);
    });

  configCmd
    .command('reset')
    .description('Reset configuration to defaults')
    .action(async () => {
      await configReset();
    });
}

// Export for interactive mode
export { configShow, configSetUrl, configReset };
