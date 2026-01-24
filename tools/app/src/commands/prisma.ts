import { Command } from 'commander';
import { exec, execCapture, confirm } from '../utils/exec.js';
import { paths } from '../utils/paths.js';
import { config } from '../utils/config.js';
import * as output from '../utils/output.js';

/**
 * Check if API container is running
 */
async function isContainerRunning(): Promise<boolean> {
  const result = await execCapture('docker', [
    'ps',
    '--filter',
    `name=${config.containerName}`,
    '--format',
    '{{.Names}}',
  ]);

  return result.stdout.trim().includes(config.containerName);
}

/**
 * Run a Prisma command inside the Docker container
 */
async function runPrismaInDocker(command: string): Promise<number> {
  const running = await isContainerRunning();

  if (!running) {
    output.error('ERROR: API container is not running.');
    output.info('Start the services first with: app start');
    return 1;
  }

  output.info(`Running in Docker container: ${command}`);

  return exec('docker', [
    'exec',
    config.containerName,
    'sh',
    '-c',
    command,
  ]);
}

/**
 * Generate Prisma client
 */
async function prismaGenerate(): Promise<void> {
  output.info('Generating Prisma client...');

  const code = await runPrismaInDocker('node scripts/prisma-env.js generate');

  if (code === 0) {
    output.success('Prisma client generated!');
  } else {
    output.error('Failed to generate Prisma client');
    process.exit(code);
  }
}

/**
 * Run Prisma migrations
 */
async function prismaMigrate(mode?: string): Promise<void> {
  switch (mode?.toLowerCase()) {
    case 'deploy':
      output.info('Applying migrations (production mode)...');
      break;
    case 'status':
      output.info('Checking migration status...');
      break;
    default:
      output.info('Applying pending migrations...');
  }

  const command =
    mode === 'status'
      ? 'node scripts/prisma-env.js migrate status'
      : 'node scripts/prisma-env.js migrate deploy';

  const code = await runPrismaInDocker(command);

  if (code === 0) {
    if (mode !== 'status') {
      output.success('Migrations applied!');
      output.blank();
      output.info('To seed the database, run: app prisma seed');
    }
  } else {
    output.error('Migration failed');
    process.exit(code);
  }
}

/**
 * Push schema changes directly
 */
async function prismaPush(): Promise<void> {
  output.info('Pushing schema changes to database...');

  const code = await runPrismaInDocker('node scripts/prisma-env.js db push');

  if (code === 0) {
    output.success('Schema pushed successfully!');
  } else {
    output.error('Failed to push schema');
    process.exit(code);
  }
}

/**
 * Open Prisma Studio
 */
async function prismaStudio(): Promise<void> {
  output.info('Opening Prisma Studio...');
  output.info('Studio will be available at: http://localhost:5555');
  output.warn('Note: Studio runs locally (not in Docker) to allow browser access');

  const code = await exec('npm', ['run', 'prisma:studio'], {
    cwd: paths.apiDir,
  });

  if (code !== 0) {
    output.error('Failed to start Prisma Studio');
    process.exit(code);
  }
}

/**
 * Seed the database
 */
async function prismaSeed(): Promise<void> {
  output.info('Seeding database...');

  const code = await runPrismaInDocker('node scripts/prisma-env.js db seed');

  if (code === 0) {
    output.success('Database seeded!');
  } else {
    output.error('Failed to seed database');
    process.exit(code);
  }
}

/**
 * Reset the database
 */
async function prismaReset(): Promise<void> {
  output.warn('WARNING: This will reset the database and DELETE all data!');

  const confirmed = await confirm('Are you sure?');

  if (confirmed) {
    output.info('Resetting database...');

    const code = await runPrismaInDocker(
      'node scripts/prisma-env.js migrate reset --force'
    );

    if (code === 0) {
      output.success('Database reset complete!');
    } else {
      output.error('Failed to reset database');
      process.exit(code);
    }
  } else {
    output.info('Reset cancelled.');
  }
}

/**
 * Show Prisma help
 */
function showPrismaHelp(): void {
  output.blank();
  output.header('Prisma Commands (runs inside Docker)');
  output.blank();
  console.log('Usage: app prisma <command>');
  output.blank();
  console.log('Commands:');
  console.log('  generate       Generate Prisma client after schema changes');
  console.log('  migrate        Apply pending migrations to database');
  console.log('  migrate status Check migration status');
  console.log('  push           Push schema changes directly (dev, no migration file)');
  console.log('  studio         Open Prisma Studio GUI (runs locally)');
  console.log('  seed           Run database seed script');
  console.log('  reset          Reset database (destroys all data)');
  output.blank();
  console.log('Workflow:');
  console.log('  1. app prisma migrate    # Apply migrations');
  console.log('  2. app prisma seed       # Seed initial data');
  output.blank();
  console.log('Examples:');
  console.log('  app prisma migrate');
  console.log('  app prisma migrate status');
  console.log('  app prisma seed');
  console.log('  app prisma studio');
  output.blank();
  console.log('Note: Commands run inside the Docker API container to ensure');
  console.log('      proper database connectivity.');
  output.blank();
}

/**
 * Register Prisma commands with Commander
 */
export function registerPrismaCommands(program: Command): void {
  const prismaCmd = program
    .command('prisma')
    .description('Prisma operations. Options: generate, migrate, studio, reset')
    .argument('[command]', 'Prisma command')
    .argument('[option]', 'Command option (e.g., status for migrate)')
    .action(async (command?: string, option?: string) => {
      switch (command?.toLowerCase()) {
        case 'generate':
          await prismaGenerate();
          break;

        case 'migrate':
          await prismaMigrate(option);
          break;

        case 'push':
          await prismaPush();
          break;

        case 'studio':
          await prismaStudio();
          break;

        case 'seed':
          await prismaSeed();
          break;

        case 'reset':
          await prismaReset();
          break;

        default:
          showPrismaHelp();
          break;
      }
    });
}

// Export for interactive mode
export {
  prismaGenerate,
  prismaMigrate,
  prismaPush,
  prismaStudio,
  prismaSeed,
  prismaReset,
  isContainerRunning,
};
