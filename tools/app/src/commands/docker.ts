import { Command } from 'commander';
import { exec, execInterruptible, confirm } from '../utils/exec.js';
import { paths, verifyPaths } from '../utils/paths.js';
import * as output from '../utils/output.js';

export interface DockerOptions {
  otel?: boolean;
}

/**
 * Get docker compose command with appropriate files
 */
function getComposeArgs(otel: boolean = false): string[] {
  const args = [
    'compose',
    '-f',
    paths.baseCompose,
    '-f',
    paths.devCompose,
  ];

  if (otel) {
    args.push('-f', paths.otelCompose);
  }

  return args;
}

/**
 * Run docker compose command
 */
async function dockerCompose(
  composeArgs: string[],
  extraArgs: string[] = []
): Promise<number> {
  const allArgs = [...composeArgs, ...extraArgs];
  output.info(`Running: docker ${allArgs.join(' ')}`);
  return exec('docker', allArgs, { cwd: paths.composeDir });
}

/**
 * Start services
 */
export async function startServices(
  service?: string,
  options: DockerOptions = {}
): Promise<void> {
  output.info('Starting EnterpriseAppBase services...');

  if (options.otel) {
    output.info('Including OpenTelemetry observability stack...');
  }

  const composeArgs = getComposeArgs(options.otel);
  const args = ['up', '-d'];

  if (service) {
    args.push(service);
  }

  const code = await dockerCompose(composeArgs, args);

  if (code === 0) {
    output.success('Services started!');
    output.printServiceUrls(options.otel);
  } else {
    output.error('Failed to start services');
    process.exit(code);
  }
}

/**
 * Stop services
 */
export async function stopServices(service?: string): Promise<void> {
  output.info('Stopping EnterpriseAppBase services...');

  const composeArgs = getComposeArgs();

  if (service) {
    const code = await dockerCompose(composeArgs, ['stop', service]);
    if (code === 0) {
      output.success(`Service ${service} stopped!`);
    } else {
      output.error(`Failed to stop service ${service}`);
      process.exit(code);
    }
  } else {
    const code = await dockerCompose(composeArgs, ['down']);
    if (code === 0) {
      output.success('Services stopped!');
    } else {
      output.error('Failed to stop services');
      process.exit(code);
    }
  }
}

/**
 * Restart services
 */
export async function restartServices(service?: string): Promise<void> {
  output.info('Restarting EnterpriseAppBase services...');

  const composeArgs = getComposeArgs();

  if (service) {
    const code = await dockerCompose(composeArgs, ['restart', service]);
    if (code === 0) {
      output.success(`Service ${service} restarted!`);
    } else {
      output.error(`Failed to restart service ${service}`);
      process.exit(code);
    }
  } else {
    await dockerCompose(composeArgs, ['down']);
    const code = await dockerCompose(composeArgs, ['up', '-d']);
    if (code === 0) {
      output.success('Services restarted!');
    } else {
      output.error('Failed to restart services');
      process.exit(code);
    }
  }
}

/**
 * Rebuild services
 */
export async function rebuildServices(
  service?: string,
  options: DockerOptions = {}
): Promise<void> {
  output.info('Rebuilding EnterpriseAppBase services (no cache)...');

  if (options.otel) {
    output.info('Including OpenTelemetry observability stack...');
  }

  const composeArgs = getComposeArgs(options.otel);

  if (service) {
    await dockerCompose(composeArgs, ['build', '--no-cache', service]);
    const code = await dockerCompose(composeArgs, ['up', '-d', service]);
    if (code === 0) {
      output.success(`Service ${service} rebuilt and started!`);
      output.printServiceUrls(options.otel);
    } else {
      output.error(`Failed to rebuild service ${service}`);
      process.exit(code);
    }
  } else {
    await dockerCompose(composeArgs, ['build', '--no-cache']);
    const code = await dockerCompose(composeArgs, ['up', '-d']);
    if (code === 0) {
      output.success('Services rebuilt and started!');
      output.printServiceUrls(options.otel);
    } else {
      output.error('Failed to rebuild services');
      process.exit(code);
    }
  }
}

/**
 * Show logs (interruptible - Ctrl+C returns to menu)
 */
export async function showLogs(service?: string): Promise<void> {
  output.info('Showing logs (Ctrl+C to return)...');
  output.blank();

  const composeArgs = getComposeArgs();
  const allArgs = [...composeArgs, 'logs', '-f'];

  if (service) {
    allArgs.push(service);
  }

  // Use execInterruptible so Ctrl+C returns to menu instead of exiting
  await execInterruptible('docker', allArgs, { cwd: paths.composeDir });

  output.blank();
  output.info('Logs closed.');
}

/**
 * Show status
 */
export async function showStatus(): Promise<void> {
  output.info('Service Status:');
  output.blank();

  const composeArgs = getComposeArgs();
  await dockerCompose(composeArgs, ['ps']);
}

/**
 * Clean services (remove volumes)
 */
export async function cleanServices(): Promise<void> {
  output.warn(
    'WARNING: This will stop all services and DELETE all data (database, volumes)!'
  );

  const confirmed = await confirm('Are you sure?');

  if (confirmed) {
    output.info('Cleaning up EnterpriseAppBase services and volumes...');
    const composeArgs = getComposeArgs();
    const code = await dockerCompose(composeArgs, ['down', '-v']);

    if (code === 0) {
      output.success('Cleanup complete! All data has been removed.');
    } else {
      output.error('Failed to clean services');
      process.exit(code);
    }
  } else {
    output.info('Cleanup cancelled.');
  }
}

/**
 * Register docker commands with Commander
 */
export function registerDockerCommands(program: Command): void {
  // Verify paths exist
  const { valid, missing } = verifyPaths();
  if (!valid) {
    output.error('ERROR: Required files not found:');
    missing.forEach((p) => output.error(`  - ${p}`));
    output.error('Make sure you are running from the EnterpriseAppBase repository.');
    process.exit(1);
  }

  program
    .command('start')
    .description('Start all services (or specific service)')
    .argument('[service]', 'Specific service to start (api, web, db, nginx)')
    .option('--otel', 'Include OpenTelemetry observability stack')
    .action(async (service: string | undefined, options: DockerOptions) => {
      await startServices(service, options);
    });

  program
    .command('stop')
    .description('Stop all services (or specific service)')
    .argument('[service]', 'Specific service to stop')
    .action(async (service: string | undefined) => {
      await stopServices(service);
    });

  program
    .command('restart')
    .description('Restart all services (or specific service)')
    .argument('[service]', 'Specific service to restart')
    .action(async (service: string | undefined) => {
      await restartServices(service);
    });

  program
    .command('rebuild')
    .description('Rebuild and restart all services (or specific service)')
    .argument('[service]', 'Specific service to rebuild')
    .option('--otel', 'Include OpenTelemetry observability stack')
    .action(async (service: string | undefined, options: DockerOptions) => {
      await rebuildServices(service, options);
    });

  program
    .command('logs')
    .description('Show logs (follow mode). Optionally specify service')
    .argument('[service]', 'Specific service to show logs for')
    .action(async (service: string | undefined) => {
      await showLogs(service);
    });

  program
    .command('status')
    .description('Show status of all services')
    .action(async () => {
      await showStatus();
    });

  program
    .command('clean')
    .description('Stop services and remove volumes (resets database)')
    .action(async () => {
      await cleanServices();
    });
}
