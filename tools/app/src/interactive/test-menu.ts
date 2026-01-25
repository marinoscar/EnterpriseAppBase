import inquirer from 'inquirer';
import {
  runApiTests,
  runWebTests,
  runE2ETests,
  runTypeCheck,
  runAllTests,
} from '../commands/test.js';
import * as output from '../utils/output.js';
import { getIcon } from '../utils/config.js';

/**
 * Show the test menu
 */
export async function showTestMenu(): Promise<void> {
  while (true) {
    output.blank();

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Testing:',
        choices: [
          {
            name: `${getIcon('✅', '>')} Run all tests (typecheck + unit)`,
            value: 'all',
          },
          {
            name: `${getIcon('🔍', '>')} Type check only`,
            value: 'typecheck',
          },
          {
            name: `${getIcon('🔧', '>')} API tests`,
            value: 'api',
          },
          {
            name: `${getIcon('🌐', '>')} Web tests`,
            value: 'web',
          },
          {
            name: `${getIcon('🔗', '>')} E2E tests`,
            value: 'e2e',
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

    if (action === 'all') {
      await runAllTests(false);
    } else if (action === 'typecheck') {
      await runTypeCheck();
    } else if (action === 'api') {
      const { mode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'mode',
          message: 'Test mode:',
          choices: [
            { name: 'Run once', value: '' },
            { name: 'Watch mode', value: 'watch' },
            { name: 'With coverage', value: 'coverage' },
            { name: 'Unit tests only', value: 'unit' },
            { name: 'E2E tests only', value: 'e2e' },
          ],
        },
      ]);

      await runApiTests(mode || undefined);
    } else if (action === 'web') {
      const { mode } = await inquirer.prompt([
        {
          type: 'list',
          name: 'mode',
          message: 'Test mode:',
          choices: [
            { name: 'Run once', value: '' },
            { name: 'Watch mode', value: 'watch' },
            { name: 'With coverage', value: 'coverage' },
            { name: 'Vitest UI', value: 'ui' },
          ],
        },
      ]);

      await runWebTests(mode || undefined);
    } else if (action === 'e2e') {
      await runE2ETests();
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
