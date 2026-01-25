import inquirer from 'inquirer';
import {
  authLogin,
  authLogout,
  authStatus,
  authWhoami,
  authTestLogin,
} from '../commands/auth.js';
import { loadTokens } from '../lib/auth-store.js';
import * as output from '../utils/output.js';
import { getIcon } from '../utils/config.js';

/**
 * Show the auth menu
 */
export async function showAuthMenu(): Promise<void> {
  // Check current auth status
  const tokens = loadTokens();
  const isLoggedIn = tokens !== null;

  while (true) {
    output.blank();

    if (isLoggedIn) {
      output.dim('Currently authenticated');
    } else {
      output.dim('Not authenticated');
    }

    const choices = [];

    if (!isLoggedIn) {
      choices.push(
        {
          name: `${getIcon('🔐', '>')} Login`,
          value: 'login',
        },
        {
          name: `${getIcon('🧪', '>')} Test Login (dev only)`,
          value: 'test-login',
        }
      );
    } else {
      choices.push(
        {
          name: `${getIcon('👤', '>')} Who am I?`,
          value: 'whoami',
        },
        {
          name: `${getIcon('📊', '>')} Auth status`,
          value: 'status',
        },
        {
          name: `${getIcon('🚪', '>')} Logout`,
          value: 'logout',
        }
      );
    }

    choices.push(
      new inquirer.Separator(),
      {
        name: `${getIcon('←', '<')} Back`,
        value: 'back',
      }
    );

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Authentication:',
        choices,
      },
    ]);

    if (action === 'back') {
      return;
    }

    try {
      switch (action) {
        case 'login':
          await authLogin();
          return; // Return to main menu after login
        case 'test-login': {
          // Prompt for email and role
          const { email } = await inquirer.prompt([
            {
              type: 'input',
              name: 'email',
              message: 'Enter email address for test user:',
              validate: (input: string) => {
                if (!input || !input.includes('@')) {
                  return 'Please enter a valid email address';
                }
                return true;
              },
            },
          ]);

          const { role } = await inquirer.prompt([
            {
              type: 'list',
              name: 'role',
              message: 'Select role:',
              choices: [
                { name: 'Viewer (default)', value: 'viewer' },
                { name: 'Contributor', value: 'contributor' },
                { name: 'Admin', value: 'admin' },
              ],
              default: 'viewer',
            },
          ]);

          await authTestLogin(email, { role });
          return; // Return to main menu after login
        }
        case 'logout':
          await authLogout();
          return; // Return to main menu after logout
        case 'status':
          await authStatus();
          break;
        case 'whoami':
          await authWhoami();
          break;
      }
    } catch (error) {
      output.error((error as Error).message);
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
