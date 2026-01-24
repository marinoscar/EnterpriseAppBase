import { Command } from 'commander';
import { apiRequest } from '../lib/api-client.js';
import * as output from '../utils/output.js';

interface User {
  id: string;
  email: string;
  displayName: string;
  isActive: boolean;
  roles: string[];
  createdAt: string;
}

interface PaginatedResponse<T> {
  data: {
    items: T[];
    total: number;
    page: number;
    limit: number;
  };
}

interface ErrorResponse {
  message?: string;
}

/**
 * List all users
 * Throws on error - caller handles error display and exit
 */
async function listUsers(options: {
  page?: number;
  limit?: number;
  json?: boolean;
}): Promise<void> {
  const page = options.page || 1;
  const limit = options.limit || 20;

  const response = await apiRequest(`/users?page=${page}&limit=${limit}`);

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.message || 'Failed to list users');
  }

  const result = (await response.json()) as PaginatedResponse<User>;

  if (options.json) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  output.header('Users');
  output.blank();

  const widths = [38, 30, 20, 10];
  output.tableHeader(['ID', 'EMAIL', 'ROLES', 'ACTIVE'], widths);

  for (const user of result.data.items) {
    output.tableRow(
      [
        user.id,
        user.email,
        user.roles.join(', '),
        user.isActive ? 'Yes' : 'No',
      ],
      widths
    );
  }

  output.blank();
  output.dim(
    `Showing ${result.data.items.length} of ${result.data.total} users (page ${result.data.page})`
  );
}

/**
 * Get a user by ID
 * Throws on error - caller handles error display and exit
 */
async function getUser(
  id: string,
  options: { json?: boolean }
): Promise<void> {
  const response = await apiRequest(`/users/${id}`);

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.message || 'Failed to get user');
  }

  const { data: user } = (await response.json()) as { data: User };

  if (options.json) {
    console.log(JSON.stringify(user, null, 2));
    return;
  }

  output.header('User Details');
  output.blank();
  output.keyValue('ID', user.id);
  output.keyValue('Email', user.email);
  output.keyValue('Display Name', user.displayName);
  output.keyValue('Roles', user.roles.join(', '));
  output.keyValue('Active', user.isActive ? 'Yes' : 'No');
  output.keyValue('Created', new Date(user.createdAt).toLocaleString());
}

/**
 * Register user commands with Commander
 */
export function registerUserCommands(program: Command): void {
  const usersCmd = program
    .command('users')
    .description('User management commands (admin only)');

  usersCmd
    .command('list')
    .description('List all users')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-l, --limit <number>', 'Items per page', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        await listUsers({
          page: parseInt(options.page, 10),
          limit: parseInt(options.limit, 10),
          json: options.json,
        });
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  usersCmd
    .command('get')
    .description('Get a user by ID')
    .argument('<id>', 'User ID')
    .option('--json', 'Output as JSON')
    .action(async (id: string, options) => {
      try {
        await getUser(id, options);
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}

// Export for interactive mode
export { listUsers, getUser };
