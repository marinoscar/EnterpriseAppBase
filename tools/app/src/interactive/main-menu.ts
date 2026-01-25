import inquirer from 'inquirer';
import { showDevMenu } from './dev-menu.js';
import { showTestMenu } from './test-menu.js';
import { showPrismaMenu } from './prisma-menu.js';
import { showAuthMenu } from './auth-menu.js';
import { showApiMenu } from './api-menu.js';
import { showStorageMenu } from './storage-menu.js';
import { showSettingsMenu } from './settings-menu.js';
import * as output from '../utils/output.js';
import { getIcon } from '../utils/config.js';

/**
 * Show the main interactive menu
 */
export async function showMainMenu(): Promise<void> {
  output.blank();
  output.bold('EnterpriseAppBase CLI');
  output.dim('Interactive mode - Use arrow keys to navigate');
  output.blank();

  while (true) {
    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          {
            name: `${getIcon('🚀', '>')} Development (start, stop, rebuild...)`,
            value: 'dev',
          },
          {
            name: `${getIcon('🧪', '>')} Testing (run tests, typecheck...)`,
            value: 'test',
          },
          {
            name: `${getIcon('🗄️', '>')} Database (prisma operations...)`,
            value: 'prisma',
          },
          {
            name: `${getIcon('🔐', '>')} Authentication (login, logout...)`,
            value: 'auth',
          },
          {
            name: `${getIcon('👥', '>')} API Commands (users, allowlist...)`,
            value: 'api',
          },
          {
            name: `${getIcon('📦', '>')} Storage (upload, download, list...)`,
            value: 'storage',
          },
          {
            name: `${getIcon('⚙️', '>')} Settings (API URL, config...)`,
            value: 'settings',
          },
          new inquirer.Separator(),
          {
            name: `${getIcon('❌', 'x')} Exit`,
            value: 'exit',
          },
        ],
      },
    ]);

    switch (action) {
      case 'dev':
        await showDevMenu();
        break;
      case 'test':
        await showTestMenu();
        break;
      case 'prisma':
        await showPrismaMenu();
        break;
      case 'auth':
        await showAuthMenu();
        break;
      case 'api':
        await showApiMenu();
        break;
      case 'storage':
        await showStorageMenu();
        break;
      case 'settings':
        await showSettingsMenu();
        break;
      case 'exit':
        output.info('Goodbye!');
        return;
    }
  }
}
