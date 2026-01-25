import inquirer from 'inquirer';
import { loadTokens } from '../lib/auth-store.js';
import {
  listObjects,
  getObject,
  uploadFile,
  downloadObject,
  deleteObject,
} from '../commands/storage.js';
import * as output from '../utils/output.js';
import { getIcon } from '../utils/config.js';
import { showAuthMenu } from './auth-menu.js';

/**
 * Prompt for object ID
 */
async function promptObjectId(): Promise<string> {
  const { id } = await inquirer.prompt([
    {
      type: 'input',
      name: 'id',
      message: 'Enter object ID:',
      validate: (input: string) => {
        if (!input.trim()) {
          return 'Object ID is required';
        }
        return true;
      },
    },
  ]);
  return id.trim();
}

/**
 * Prompt for file path
 */
async function promptFilePath(): Promise<string> {
  const { filePath } = await inquirer.prompt([
    {
      type: 'input',
      name: 'filePath',
      message: 'Enter file path to upload:',
      validate: (input: string) => {
        if (!input.trim()) {
          return 'File path is required';
        }
        return true;
      },
    },
  ]);
  return filePath.trim();
}

/**
 * Show the storage menu
 */
export async function showStorageMenu(): Promise<void> {
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
        message: 'Storage Operations:',
        choices: [
          {
            name: `${getIcon('📋', '>')} List my files`,
            value: 'list',
          },
          {
            name: `${getIcon('📤', '>')} Upload a file`,
            value: 'upload',
          },
          {
            name: `${getIcon('📥', '>')} Download a file`,
            value: 'download',
          },
          {
            name: `${getIcon('🔍', '>')} Get file details`,
            value: 'get',
          },
          {
            name: `${getIcon('🗑️', '>')} Delete a file`,
            value: 'delete',
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
        case 'list':
          await listObjects({});
          break;

        case 'upload': {
          const filePath = await promptFilePath();
          await uploadFile(filePath, {});
          break;
        }

        case 'download': {
          const downloadId = await promptObjectId();
          const { openInBrowser } = await inquirer.prompt([
            {
              type: 'confirm',
              name: 'openInBrowser',
              message: 'Open download URL in browser?',
              default: true,
            },
          ]);
          await downloadObject(downloadId, { open: openInBrowser });
          break;
        }

        case 'get': {
          const getId = await promptObjectId();
          await getObject(getId, {});
          break;
        }

        case 'delete': {
          const deleteId = await promptObjectId();
          await deleteObject(deleteId, {});
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
          continue; // Skip the "Press Enter" prompt and show storage menu again
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
