import inquirer from 'inquirer';
import { loadTokens } from '../lib/auth-store.js';
import { initSync, runSync, syncStatus, resetSync } from '../commands/sync.js';
import { isSyncFolder } from '../lib/sync-engine.js';
import * as output from '../utils/output.js';
import { getIcon } from '../utils/config.js';
import { showAuthMenu } from './auth-menu.js';

/**
 * Prompt for folder path
 */
async function promptFolderPath(message: string): Promise<string> {
  const { folderPath } = await inquirer.prompt([
    {
      type: 'input',
      name: 'folderPath',
      message,
      validate: (input: string) => {
        if (!input.trim()) {
          return 'Folder path is required';
        }
        return true;
      },
    },
  ]);
  return folderPath.trim();
}

/**
 * Show the sync menu
 */
export async function showSyncMenu(): Promise<void> {
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
        message: 'Sync Folder Operations:',
        choices: [
          {
            name: `${getIcon('📁', '>')} Initialize sync folder`,
            value: 'init',
          },
          {
            name: `${getIcon('🔄', '>')} Run sync now`,
            value: 'run',
          },
          {
            name: `${getIcon('📊', '>')} Check sync status`,
            value: 'status',
          },
          {
            name: `${getIcon('🗑️', '>')} Reset sync state`,
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

    try {
      switch (action) {
        case 'init': {
          const folderPath = await promptFolderPath(
            'Enter folder path to initialize:'
          );
          await initSync(folderPath);
          break;
        }

        case 'run': {
          const folderPath = await promptFolderPath('Enter sync folder path:');

          const { options } = await inquirer.prompt([
            {
              type: 'checkbox',
              name: 'options',
              message: 'Select options:',
              choices: [
                {
                  name: 'Dry run (preview changes)',
                  value: 'dryRun',
                },
                {
                  name: 'Verbose output',
                  value: 'verbose',
                },
              ],
            },
          ]);

          await runSync(folderPath, {
            dryRun: options.includes('dryRun'),
            verbose: options.includes('verbose'),
          });
          break;
        }

        case 'status': {
          const folderPath = await promptFolderPath('Enter sync folder path:');
          await syncStatus(folderPath);
          break;
        }

        case 'reset': {
          const folderPath = await promptFolderPath(
            'Enter sync folder path to reset:'
          );
          await resetSync(folderPath, {});
          break;
        }
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
          continue; // Skip the "Press Enter" prompt and show sync menu again
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
