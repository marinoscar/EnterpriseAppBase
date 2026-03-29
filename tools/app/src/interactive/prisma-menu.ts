import inquirer from 'inquirer';
import {
  prismaGenerate,
  prismaMigrate,
  prismaPush,
  prismaStudio,
  prismaSeed,
  prismaReset,
} from '../commands/prisma.js';
import * as output from '../utils/output.js';
import { getIcon } from '../utils/config.js';

/**
 * Show the Prisma menu
 */
export async function showPrismaMenu(): Promise<void> {
  while (true) {
    output.blank();

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Database (Prisma):',
        choices: [
          {
            name: `${getIcon('🔄', '>')} Generate Prisma client`,
            value: 'generate',
          },
          {
            name: `${getIcon('📤', '>')} Apply migrations`,
            value: 'migrate',
          },
          {
            name: `${getIcon('📊', '>')} Check migration status`,
            value: 'status',
          },
          {
            name: `${getIcon('⬆️', '>')} Push schema (no migration)`,
            value: 'push',
          },
          {
            name: `${getIcon('🌱', '>')} Seed database`,
            value: 'seed',
          },
          {
            name: `${getIcon('🖥️', '>')} Open Prisma Studio`,
            value: 'studio',
          },
          {
            name: `${getIcon('🗑️', '!')} Reset database`,
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
      case 'generate':
        await prismaGenerate();
        break;
      case 'migrate':
        await prismaMigrate();
        break;
      case 'status':
        await prismaMigrate('status');
        break;
      case 'push':
        await prismaPush();
        break;
      case 'seed':
        await prismaSeed();
        break;
      case 'studio':
        await prismaStudio();
        break;
      case 'reset':
        await prismaReset();
        break;
    }

    // Wait for user to press enter before showing menu again
    // (except for studio which is a long-running process)
    if (action !== 'studio') {
      await inquirer.prompt([
        {
          type: 'input',
          name: 'continue',
          message: 'Press Enter to continue...',
        },
      ]);
    }
  }
}
