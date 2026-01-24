import { Command } from 'commander';
import inquirer from 'inquirer';
import { apiRequest } from '../lib/api-client.js';
import { validateEmail, sanitizeEmail } from '../lib/validators.js';
import * as output from '../utils/output.js';

interface AllowlistEntry {
  id: string;
  email: string;
  notes: string | null;
  status: 'pending' | 'claimed';
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

interface AllowlistAnswers {
  email: string;
  notes: string;
  confirm: boolean;
}

/**
 * List all allowlisted emails
 * Throws on error - caller handles error display and exit
 */
async function listAllowlist(options: {
  page?: number;
  limit?: number;
  json?: boolean;
}): Promise<void> {
  const page = options.page || 1;
  const limit = options.limit || 20;

  const response = await apiRequest(`/allowlist?page=${page}&limit=${limit}`);

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.message || 'Failed to list allowlist');
  }

  const result = (await response.json()) as PaginatedResponse<AllowlistEntry>;

  if (options.json) {
    console.log(JSON.stringify(result.data, null, 2));
    return;
  }

  output.header('Allowlist');
  output.blank();

  const widths = [30, 10, 25, 20];
  output.tableHeader(['EMAIL', 'STATUS', 'NOTES', 'ADDED'], widths);

  for (const entry of result.data.items) {
    output.tableRow(
      [
        entry.email,
        entry.status,
        entry.notes || '-',
        new Date(entry.createdAt).toLocaleDateString(),
      ],
      widths
    );
  }

  output.blank();
  output.dim(
    `Showing ${result.data.items.length} of ${result.data.total} entries (page ${result.data.page})`
  );
}

/**
 * Add an email to the allowlist (interactive)
 */
async function addToAllowlistInteractive(): Promise<void> {
  const answers = await inquirer.prompt<AllowlistAnswers>([
    {
      type: 'input',
      name: 'email',
      message: 'Email address to allowlist:',
      validate: validateEmail,
      filter: sanitizeEmail,
    },
    {
      type: 'input',
      name: 'notes',
      message: 'Notes (optional):',
      default: '',
    },
    {
      type: 'confirm',
      name: 'confirm',
      message: (answers: { email: string }) =>
        `Add ${answers.email} to allowlist?`,
      default: true,
    },
  ]);

  if (!answers.confirm) {
    output.info('Cancelled.');
    return;
  }

  await addToAllowlist(answers.email, answers.notes || undefined);
}

/**
 * Add an email to the allowlist
 * Throws on error - caller handles error display and exit
 */
async function addToAllowlist(
  email: string,
  notes?: string
): Promise<void> {
  // Validate email
  const validationResult = validateEmail(email);
  if (validationResult !== true) {
    throw new Error(validationResult as string);
  }

  const response = await apiRequest('/allowlist', {
    method: 'POST',
    body: JSON.stringify({
      email: sanitizeEmail(email),
      notes: notes || undefined,
    }),
  });

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.message || 'Failed to add to allowlist');
  }

  output.success(`Added ${email} to allowlist`);
}

/**
 * Remove an email from the allowlist
 * Throws on error - caller handles error display and exit
 */
async function removeFromAllowlist(id: string): Promise<void> {
  const response = await apiRequest(`/allowlist/${id}`, {
    method: 'DELETE',
  });

  if (!response.ok) {
    const error = (await response.json()) as ErrorResponse;
    throw new Error(error.message || 'Failed to remove from allowlist');
  }

  output.success('Removed from allowlist');
}

/**
 * Register allowlist commands with Commander
 */
export function registerAllowlistCommands(program: Command): void {
  const allowlistCmd = program
    .command('allowlist')
    .description('Allowlist management commands (admin only)');

  allowlistCmd
    .command('list')
    .description('List all allowlisted emails')
    .option('-p, --page <number>', 'Page number', '1')
    .option('-l, --limit <number>', 'Items per page', '20')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      try {
        await listAllowlist({
          page: parseInt(options.page, 10),
          limit: parseInt(options.limit, 10),
          json: options.json,
        });
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  allowlistCmd
    .command('add')
    .description('Add an email to the allowlist')
    .argument('[email]', 'Email address to add')
    .option('-n, --notes <text>', 'Optional notes')
    .action(async (email: string | undefined, options) => {
      try {
        if (email) {
          await addToAllowlist(email, options.notes);
        } else {
          await addToAllowlistInteractive();
        }
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });

  allowlistCmd
    .command('remove')
    .description('Remove an email from the allowlist')
    .argument('<id>', 'Allowlist entry ID')
    .action(async (id: string) => {
      try {
        await removeFromAllowlist(id);
      } catch (error) {
        output.error((error as Error).message);
        process.exit(1);
      }
    });
}

// Export for interactive mode
export {
  listAllowlist,
  addToAllowlist,
  addToAllowlistInteractive,
  removeFromAllowlist,
};
