import { Command } from 'commander';
import { checkHealth } from '../lib/api-client.js';
import * as output from '../utils/output.js';
import { config } from '../utils/config.js';

/**
 * Check API health
 */
async function healthCheck(options: { json?: boolean }): Promise<void> {
  try {
    const health = await checkHealth();

    if (options.json) {
      console.log(JSON.stringify(health, null, 2));
      return;
    }

    output.header('API Health');
    output.blank();
    output.keyValue('API URL', config.apiUrl);
    output.blank();

    if (health.live) {
      output.success('Liveness:  OK');
    } else {
      output.error('Liveness:  FAILED');
    }

    if (health.ready) {
      output.success('Readiness: OK');
    } else {
      output.error('Readiness: FAILED');
    }

    output.blank();

    if (health.live && health.ready) {
      output.success('API is healthy and ready to accept requests.');
    } else if (health.live) {
      output.warn('API is running but not ready (database may be unavailable).');
    } else {
      output.error('API is not responding. Is the server running?');
      output.info('Try: app start');
    }
  } catch (error) {
    output.error('Failed to check health: API is not responding');
    output.info('Make sure the services are running: app start');
    process.exit(1);
  }
}

/**
 * Register health commands with Commander
 */
export function registerHealthCommands(program: Command): void {
  program
    .command('health')
    .description('Check API health status')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await healthCheck(options);
    });
}

// Export for interactive mode
export { healthCheck };
