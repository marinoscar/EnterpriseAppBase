import { Command } from 'commander';
import { exec, confirm } from '../utils/exec.js';
import { paths } from '../utils/paths.js';
import * as output from '../utils/output.js';

/**
 * Run a Prisma command locally using the prisma-env.js helper
 */
async function runPrismaLocal(command: string): Promise<number> {
  output.info(`Running: node scripts/prisma-env.js ${command}`);

  return exec('node', ['scripts/prisma-env.js', ...command.split(' ')], {
    cwd: paths.apiDir,
  });
}

/**
 * Generate Prisma client
 */
async function prismaGenerate(): Promise<void> {
  output.info('Generating Prisma client...');

  const code = await runPrismaLocal('generate');

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
      ? 'migrate status'
      : 'migrate deploy';

  const code = await runPrismaLocal(command);

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

  const code = await runPrismaLocal('db push');

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

  const code = await runPrismaLocal('db seed');

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

    const code = await runPrismaLocal('migrate reset --force');

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
  output.header('Prisma Commands');
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
  console.log('Note: Commands run locally using env vars from infra/compose/.env');
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
};
