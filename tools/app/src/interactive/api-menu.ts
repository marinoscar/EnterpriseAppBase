import inquirer from 'inquirer';
import { loadTokens } from '../lib/auth-store.js';
import { listUsers } from '../commands/users.js';
import {
  listAllowlist,
  addToAllowlistInteractive,
} from '../commands/allowlist.js';
import { getUserSettings, getSystemSettings } from '../commands/settings.js';
import { healthCheck } from '../commands/health.js';
import * as output from '../utils/output.js';
import { getIcon } from '../utils/config.js';
import { showAuthMenu } from './auth-menu.js';

/**
 * Show the API menu
 */
export async function showApiMenu(): Promise<void> {
  // Check if authenticated
  const tokens = loadTokens();
  if (!tokens) {
    output.blank();
    output.warn('Not authenticated.');
    output.info('Please login first: app auth login');
    output.blank();

    await inquirer.prompt([
      {
        type: 'input',
        name: 'continue',
        message: 'Press Enter to continue...',
      },
    ]);
    return;
  }

  while (true) {
    output.blank();

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'API Commands:',
        choices: [
          {
            name: `${getIcon('💚', '>')} Check API health`,
            value: 'health',
          },
          new inquirer.Separator('─── Users ───'),
          {
            name: `${getIcon('👥', '>')} List users`,
            value: 'users-list',
          },
          new inquirer.Separator('─── Allowlist ───'),
          {
            name: `${getIcon('📋', '>')} View allowlist`,
            value: 'allowlist-list',
          },
          {
            name: `${getIcon('➕', '>')} Add to allowlist`,
            value: 'allowlist-add',
          },
          new inquirer.Separator('─── Settings ───'),
          {
            name: `${getIcon('⚙️', '>')} View my settings`,
            value: 'settings-user',
          },
          {
            name: `${getIcon('🔧', '>')} View system settings`,
            value: 'settings-system',
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

    try {
      switch (action) {
        case 'health':
          await healthCheck({});
          break;
        case 'users-list':
          await listUsers({});
          break;
        case 'allowlist-list':
          await listAllowlist({});
          break;
        case 'allowlist-add':
          await addToAllowlistInteractive();
          break;
        case 'settings-user':
          await getUserSettings({});
          break;
        case 'settings-system':
          await getSystemSettings({});
          break;
      }
    } catch (error) {
      const errorMsg = (error as Error).message;
      output.error(errorMsg);

      // Check if this is an authentication error and offer to login
      if (
        errorMsg.includes('Session expired') ||
        errorMsg.includes('Not authenticated') ||
        errorMsg.includes('login')
      ) {
        output.blank();
        const { loginNow } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'loginNow',
            message: 'Would you like to login now?',
            default: true,
          },
        ]);

        if (loginNow) {
          await showAuthMenu();
          continue; // Skip the "Press Enter" prompt and show API menu again
        }
      }
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
