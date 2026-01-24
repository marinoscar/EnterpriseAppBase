#!/usr/bin/env node

import { Command } from 'commander';
import { registerDockerCommands } from './commands/docker.js';
import { registerTestCommands } from './commands/test.js';
import { registerPrismaCommands } from './commands/prisma.js';
import { registerAuthCommands } from './commands/auth.js';
import { registerUserCommands } from './commands/users.js';
import { registerAllowlistCommands } from './commands/allowlist.js';
import { registerSettingsCommands } from './commands/settings.js';
import { registerHealthCommands } from './commands/health.js';
import { registerConfigCommands } from './commands/config.js';
import { showMainMenu } from './interactive/main-menu.js';

const program = new Command();

program
  .name('app')
  .description('EnterpriseAppBase CLI - Development and API management tool')
  .version('1.0.0')
  .option('-i, --interactive', 'Force interactive mode');

// Register all command groups
registerDockerCommands(program);
registerTestCommands(program);
registerPrismaCommands(program);
registerAuthCommands(program);
registerUserCommands(program);
registerAllowlistCommands(program);
registerSettingsCommands(program);
registerHealthCommands(program);
registerConfigCommands(program);

// Add help examples
program.addHelpText(
  'after',
  `
Examples:
  Development:
    $ app start              # Start all services
    $ app start --otel       # Start with observability
    $ app stop               # Stop all services
    $ app rebuild api        # Rebuild API service
    $ app logs api           # Follow API logs
    $ app status             # Show service status

  Testing:
    $ app test               # Run all tests
    $ app test api watch     # API tests in watch mode
    $ app test web ui        # Open Vitest UI

  Database:
    $ app prisma migrate     # Apply migrations
    $ app prisma seed        # Seed database
    $ app prisma studio      # Open Prisma Studio

  Authentication:
    $ app auth login         # Login via browser
    $ app auth whoami        # Show current user

  API:
    $ app health             # Check API health
    $ app users list         # List users
    $ app allowlist add      # Add to allowlist

  Configuration:
    $ app config show        # Show current config
    $ app config set-url     # Set API URL
    $ app config reset       # Reset to defaults

  Interactive:
    $ app                    # Launch interactive menu
    $ app -i                 # Force interactive mode

Documentation:
  See README.md for full documentation
  GitHub: https://github.com/your-org/EnterpriseAppBase
`
);

// Parse arguments
const args = process.argv.slice(2);

// If no arguments or -i flag, show interactive menu
if (args.length === 0 || args[0] === '-i' || args[0] === '--interactive') {
  showMainMenu().catch((error) => {
    console.error('Error:', error.message);
    process.exit(1);
  });
} else {
  // Parse and execute command
  program.parse();
}
