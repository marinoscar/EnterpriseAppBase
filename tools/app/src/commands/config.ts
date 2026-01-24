import { Command } from 'commander';
import inquirer from 'inquirer';
import {
  getApiUrl,
  getAppUrl,
  setApiUrl,
  clearConfig,
  loadConfig,
  getApiUrlSource,
} from '../lib/config-store.js';
import { validateUrl, normalizeApiUrl } from '../lib/validators.js';
import { checkHealth } from '../lib/api-client.js';
import * as output from '../utils/output.js';

/**
 * Show current configuration
 */
async function configShow(): Promise<void> {
  output.header('CLI Configuration');
  output.blank();

  const apiUrl = getApiUrl();
  const appUrl = getAppUrl();
  const source = getApiUrlSource();

  output.keyValue('API URL', apiUrl);
  output.keyValue('App URL', appUrl);
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
 * Set API URL interactively or from argument
 */
async function configSetUrl(url?: string): Promise<void> {
  let targetUrl = url;

  if (!targetUrl) {
    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Enter API URL:',
        default: getApiUrl(),
        validate: validateUrl,
      },
    ]);
    targetUrl = answer.url;
  }

  const normalized = normalizeApiUrl(targetUrl!);

  // Validate format
  const validation = validateUrl(normalized);
  if (validation !== true) {
    output.error(validation as string);
    process.exit(1);
  }

  // Test connection (optional, don't block on failure)
  output.info(`Testing connection to ${normalized}...`);
  try {
    // Temporarily test with the new URL
    const testUrl = normalized.endsWith('/api') ? normalized : `${normalized}/api`;
    const response = await fetch(`${testUrl}/health/live`);
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
  const urlToSave = normalized.endsWith('/api') ? normalized : `${normalized}/api`;
  setApiUrl(urlToSave);

  output.blank();
  output.success(`API URL set to: ${urlToSave}`);
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
  output.keyValue('API URL', getApiUrl());
  output.keyValue('App URL', getAppUrl());
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
    .description('Set the API URL')
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
