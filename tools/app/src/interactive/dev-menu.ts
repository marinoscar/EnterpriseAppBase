import inquirer from 'inquirer';
import {
  startServices,
  stopServices,
  restartServices,
  rebuildServices,
  showLogs,
  showStatus,
  cleanServices,
} from '../commands/docker.js';
import * as output from '../utils/output.js';
import { getIcon } from '../utils/config.js';

/**
 * Show the development menu
 */
export async function showDevMenu(): Promise<void> {
  while (true) {
    output.blank();

    const { action } = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: 'Development:',
        choices: [
          {
            name: `${getIcon('▶️', '>')} Start services`,
            value: 'start',
          },
          {
            name: `${getIcon('⏹️', 'x')} Stop services`,
            value: 'stop',
          },
          {
            name: `${getIcon('🔄', '~')} Restart services`,
            value: 'restart',
          },
          {
            name: `${getIcon('🔨', '#')} Rebuild services`,
            value: 'rebuild',
          },
          {
            name: `${getIcon('📋', '>')} View logs`,
            value: 'logs',
          },
          {
            name: `${getIcon('📊', '>')} Show status`,
            value: 'status',
          },
          {
            name: `${getIcon('🗑️', '!')} Clean (remove volumes)`,
            value: 'clean',
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

    // For start/rebuild, ask about otel
    if (action === 'start' || action === 'rebuild') {
      const { otel, service } = await inquirer.prompt([
        {
          type: 'list',
          name: 'service',
          message: 'Which service?',
          choices: [
            { name: 'All services', value: '' },
            { name: 'API only', value: 'api' },
            { name: 'Web only', value: 'web' },
            { name: 'Database only', value: 'db' },
            { name: 'Nginx only', value: 'nginx' },
          ],
        },
        {
          type: 'confirm',
          name: 'otel',
          message: 'Include OpenTelemetry observability stack?',
          default: false,
        },
      ]);

      if (action === 'start') {
        await startServices(service || undefined, { otel });
      } else {
        await rebuildServices(service || undefined, { otel });
      }
    } else if (action === 'logs') {
      const { service } = await inquirer.prompt([
        {
          type: 'list',
          name: 'service',
          message: 'Which service?',
          choices: [
            { name: 'All services', value: '' },
            { name: 'API', value: 'api' },
            { name: 'Web', value: 'web' },
            { name: 'Database', value: 'db' },
            { name: 'Nginx', value: 'nginx' },
          ],
        },
      ]);

      await showLogs(service || undefined);
    } else if (action === 'stop') {
      await stopServices();
    } else if (action === 'restart') {
      await restartServices();
    } else if (action === 'status') {
      await showStatus();
    } else if (action === 'clean') {
      await cleanServices();
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
