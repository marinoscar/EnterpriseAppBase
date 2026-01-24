import { Command } from 'commander';
import { apiRequest } from '../lib/api-client.js';
import * as output from '../utils/output.js';

interface ErrorResponse {
  message?: string;
}

interface DataResponse {
  data: unknown;
}

/**
 * Get current user's settings
 */
async function getUserSettings(options: { json?: boolean }): Promise<void> {
  try {
    const response = await apiRequest('/user-settings');

    if (!response.ok) {
      const error = (await response.json()) as ErrorResponse;
      throw new Error(error.message || 'Failed to get user settings');
    }

    const result = (await response.json()) as DataResponse;

    if (options.json) {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    output.header('User Settings');
    output.blank();
    console.log(JSON.stringify(result.data, null, 2));
  } catch (error) {
    output.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Update a user setting
 */
async function updateUserSetting(
  key: string,
  value: string
): Promise<void> {
  try {
    // Try to parse the value as JSON
    let parsedValue: unknown;
    try {
      parsedValue = JSON.parse(value);
    } catch {
      // If not valid JSON, use as string
      parsedValue = value;
    }

    const response = await apiRequest('/user-settings', {
      method: 'PATCH',
      body: JSON.stringify({ [key]: parsedValue }),
    });

    if (!response.ok) {
      const error = (await response.json()) as ErrorResponse;
      throw new Error(error.message || 'Failed to update setting');
    }

    output.success(`Updated setting: ${key}`);
  } catch (error) {
    output.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Get system settings (admin only)
 */
async function getSystemSettings(options: { json?: boolean }): Promise<void> {
  try {
    const response = await apiRequest('/system-settings');

    if (!response.ok) {
      const error = (await response.json()) as ErrorResponse;
      throw new Error(error.message || 'Failed to get system settings');
    }

    const result = (await response.json()) as DataResponse;

    if (options.json) {
      console.log(JSON.stringify(result.data, null, 2));
      return;
    }

    output.header('System Settings');
    output.blank();
    console.log(JSON.stringify(result.data, null, 2));
  } catch (error) {
    output.error((error as Error).message);
    process.exit(1);
  }
}

/**
 * Register settings commands with Commander
 */
export function registerSettingsCommands(program: Command): void {
  const settingsCmd = program
    .command('settings')
    .description('Settings management commands');

  settingsCmd
    .command('get')
    .description('Get current user settings')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await getUserSettings(options);
    });

  settingsCmd
    .command('set')
    .description('Update a user setting')
    .argument('<key>', 'Setting key')
    .argument('<value>', 'Setting value (JSON or string)')
    .action(async (key: string, value: string) => {
      await updateUserSetting(key, value);
    });

  settingsCmd
    .command('system')
    .description('Get system settings (admin only)')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await getSystemSettings(options);
    });
}

// Export for interactive mode
export { getUserSettings, updateUserSetting, getSystemSettings };
