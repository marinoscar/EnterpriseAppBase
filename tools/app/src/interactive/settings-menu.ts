import inquirer from 'inquirer';
import {
  getApiUrl,
  getAppUrl,
  setApiUrl,
  clearConfig,
  getApiUrlSource,
} from '../lib/config-store.js';
import { validateUrl, normalizeApiUrl } from '../lib/validators.js';
import * as output from '../utils/output.js';
import { getIcon } from '../utils/config.js';

/**
 * Configure API URL interactively
 */
async function configureApiUrl(): Promise<void> {
  const currentUrl = getApiUrl();
  const source = getApiUrlSource();

  output.blank();
  output.keyValue('Current API URL', currentUrl);

  switch (source) {
    case 'environment':
      output.dim('(from environment variable - cannot be changed here)');
      output.info('To change, update the APP_API_URL environment variable.');
      return;
    case 'config':
      output.dim('(from saved configuration)');
      break;
    case 'default':
      output.dim('(using default - not configured)');
      break;
  }

  output.blank();

  const { url } = await inquirer.prompt([
    {
      type: 'input',
      name: 'url',
      message: 'Enter new API URL:',
      default: currentUrl,
      validate: validateUrl,
    },
  ]);

  const normalized = normalizeApiUrl(url);

  // Test connection
  output.info(`Testing connection to ${normalized}...`);
  try {
    const testUrl = normalized.endsWith('/api') ? normalized : `${normalized}/api`;
    const response = await fetch(`${testUrl}/health/live`);
    if (response.ok) {
      output.success('Connection successful!');
    } else {
      output.warn('Server responded but health check failed.');
    }
  } catch {
    output.warn('Could not connect to server.');
    output.dim('(You can save the URL anyway and connect later)');
  }

  // Confirm save
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Save this URL?',
      default: true,
    },
  ]);

  if (confirm) {
    const urlToSave = normalized.endsWith('/api') ? normalized : `${normalized}/api`;
    setApiUrl(urlToSave);
    output.success(`API URL saved: ${urlToSave}`);
  } else {
    output.info('Cancelled.');
  }
}

/**
 * Show current configuration
 */
async function showCurrentConfig(): Promise<void> {
  output.header('Current Configuration');
  output.blank();

  const apiUrl = getApiUrl();
  const appUrl = getAppUrl();
  const source = getApiUrlSource();

  output.keyValue('API URL', apiUrl);
  output.keyValue('App URL', appUrl);
  output.blank();

  switch (source) {
    case 'environment':
      output.dim('Source: Environment variable');
      break;
    case 'config':
      output.dim('Source: Saved configuration');
      break;
    case 'default':
      output.dim('Source: Default (not configured)');
      break;
  }
}

/**
 * Reset configuration to defaults
 */
async function resetConfig(): Promise<void> {
  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: 'Reset all configuration to defaults?',
      default: false,
    },
  ]);

  if (confirm) {
    clearConfig();
    output.success('Configuration reset to defaults.');
    output.blank();
    output.keyValue('API URL', getApiUrl());
  } else {
    output.info('Cancelled.');
  }
}

/**
 * Show the settings menu
 */
export async function showSettingsMenu(): Promise<void> {
  while (true) {
    output.blank();
    output.dim(`API URL: ${getApiUrl()}`);

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Settings:',
        choices: [
          {
            name: `${getIcon('🔗', '>')} Configure API URL`,
            value: 'config-url',
          },
          {
            name: `${getIcon('📋', '>')} View current configuration`,
            value: 'show',
          },
          {
            name: `${getIcon('🔄', '>')} Reset to defaults`,
            value: 'reset',
          },
          new inquirer.Separator(),
          {
            name: `${getIcon('←', '<')} Back`,
            value: 'back',
          },
        ],
      },
    ]);

    if (action === 'back') {
      return;
    }

    switch (action) {
      case 'config-url':
        await configureApiUrl();
        break;
      case 'show':
        await showCurrentConfig();
        break;
      case 'reset':
        await resetConfig();
        break;
    }

    // Wait for user to press enter before showing menu again
    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: 'Press Enter to continue...',
      },
    ]);
  }
}

// Export for use in other menus
export { configureApiUrl };
