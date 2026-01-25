# CLI Architecture

This document explains how the EnterpriseAppBase CLI is structured and how to extend it.

## Directory Structure

```
tools/app/
├── bin/
│   └── app.js              # Entry point with shebang
├── src/
│   ├── index.ts            # Main entry - routes to interactive or command mode
│   ├── commands/           # Command implementations (Commander.js)
│   │   ├── config.ts       # Configuration commands (URL setup)
│   │   ├── docker.ts       # Docker compose operations
│   │   ├── test.ts         # Test running commands
│   │   ├── prisma.ts       # Prisma database operations
│   │   ├── auth.ts         # Authentication commands
│   │   ├── users.ts        # User management
│   │   ├── allowlist.ts    # Allowlist management
│   │   ├── settings.ts     # Settings commands
│   │   └── health.ts       # Health check commands
│   ├── interactive/        # Menu-driven UI components
│   │   ├── main-menu.ts    # Root menu navigation
│   │   ├── dev-menu.ts     # Development operations menu
│   │   ├── test-menu.ts    # Testing menu
│   │   ├── prisma-menu.ts  # Database menu
│   │   ├── auth-menu.ts    # Authentication menu
│   │   ├── api-menu.ts     # API commands menu
│   │   └── settings-menu.ts # Settings/configuration menu
│   ├── lib/                # Core libraries
│   │   ├── api-client.ts   # HTTP client with auth
│   │   ├── auth-store.ts   # Token persistence
│   │   ├── config-store.ts # Configuration persistence (URL)
│   │   ├── device-flow.ts  # RFC 8628 device auth
│   │   └── validators.ts   # Input validation
│   └── utils/              # Shared utilities
│       ├── config.ts       # CLI configuration
│       ├── exec.ts         # Subprocess execution
│       ├── output.ts       # Console formatting
│       └── paths.ts        # Path resolution
├── docs/
│   ├── ARCHITECTURE.md     # This file
│   └── COMMANDS.md         # Command reference
├── package.json
├── tsconfig.json
└── README.md
```

## How It Works

### Entry Point (index.ts)

The CLI has two modes:

1. **No arguments → Interactive mode**: Shows the main menu
2. **With arguments → Command mode**: Parses with Commander.js and executes

```typescript
if (args.length === 0 || args[0] === '-i') {
  showMainMenu();  // Interactive
} else {
  program.parse(); // Command mode
}
```

### Command Pattern

Each command file follows this pattern:

```typescript
// src/commands/mycommand.ts
import { Command } from 'commander';

// The actual command logic
async function doSomething(options: Options): Promise<void> {
  // Implementation
}

// Register with Commander
export function registerMyCommands(program: Command): void {
  program
    .command('mycommand')
    .description('Does something useful')
    .option('--flag', 'Optional flag')
    .action(async (options) => {
      await doSomething(options);
    });
}

// Export for interactive mode
export { doSomething };
```

### Interactive Menu Pattern

Each menu file follows this pattern:

```typescript
// src/interactive/my-menu.ts
import inquirer from 'inquirer';
import { doSomething } from '../commands/mycommand.js';

export async function showMyMenu(): Promise<void> {
  while (true) {
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'My Menu:',
      choices: [
        { name: 'Do something', value: 'something' },
        { name: '← Back', value: 'back' },
      ],
    }]);

    if (action === 'back') return;

    if (action === 'something') {
      await doSomething({});
    }
  }
}
```

## Adding a New Command

### Step 1: Create Command File

Create `src/commands/myfeature.ts`:

```typescript
import { Command } from 'commander';
import { apiRequest } from '../lib/api-client.js';
import * as output from '../utils/output.js';

interface MyOptions {
  json?: boolean;
}

async function myAction(options: MyOptions): Promise<void> {
  try {
    const response = await apiRequest('/my-endpoint');

    if (!response.ok) {
      throw new Error('Request failed');
    }

    const data = await response.json();

    if (options.json) {
      console.log(JSON.stringify(data, null, 2));
    } else {
      output.header('My Feature');
      // Format output
    }
  } catch (error) {
    output.error((error as Error).message);
    process.exit(1);
  }
}

export function registerMyFeatureCommands(program: Command): void {
  program
    .command('myfeature')
    .description('Description of my feature')
    .option('--json', 'Output as JSON')
    .action(async (options) => {
      await myAction(options);
    });
}

export { myAction };
```

### Step 2: Register in index.ts

```typescript
import { registerMyFeatureCommands } from './commands/myfeature.js';

// In the setup section
registerMyFeatureCommands(program);
```

### Step 3: Add to Interactive Menu (Optional)

Edit the relevant menu file (e.g., `src/interactive/api-menu.ts`):

```typescript
import { myAction } from '../commands/myfeature.js';

// Add to choices array
{
  name: `${getIcon('✨', '>')} My Feature`,
  value: 'myfeature',
},

// Add to switch statement
case 'myfeature':
  await myAction({});
  break;
```

## API Client

All authenticated API calls use `lib/api-client.ts`:

```typescript
import { apiRequest } from '../lib/api-client.js';

// GET request
const response = await apiRequest('/users');

// POST request
const response = await apiRequest('/allowlist', {
  method: 'POST',
  body: JSON.stringify({ email: 'user@example.com' }),
});

// Check response
if (!response.ok) {
  const error = await response.json();
  throw new Error(error.message);
}

const data = await response.json();
```

Features:
- Uses configured API URL from config-store
- Auto-injects Authorization header from stored token
- Auto-refreshes expired tokens
- Throws clear error if not authenticated

The API client automatically uses the configured URL:
- Calls `getApiUrl()` to determine the base URL
- Respects URL priority: `APP_API_URL` env var > derived from `APP_URL` > default

## Configuration Storage

### Config Store (URL Configuration)

Configuration is stored in `~/.config/app/config.json`:

```json
{
  "appUrl": "https://myapp.company.com"
}
```

Use the config-store module:

```typescript
import {
  getAppUrl,
  getApiUrl,
  setAppUrl,
  clearConfig,
  isAppUrlConfigured,
  getAppUrlSource
} from '../lib/config-store.js';

// Get URLs (respects priority: env var > config > default)
const appUrl = getAppUrl();  // e.g., "https://myapp.com"
const apiUrl = getApiUrl();  // e.g., "https://myapp.com/api"

// Check configuration source
const source = getAppUrlSource();  // 'environment' | 'config' | 'default'

// Set URL (saves to config file)
setAppUrl('https://myapp.com');

// Clear config (reverts to default)
clearConfig();

// Check if configured (not using default)
if (!isAppUrlConfigured()) {
  // Prompt user to configure
}
```

### Token Storage

Authentication tokens are stored in `~/.config/app/auth.json`:

```json
{
  "accessToken": "eyJhbGc...",
  "refreshToken": "abc123...",
  "expiresAt": 1706012400000
}
```

Use the auth-store module:

```typescript
import { loadTokens, saveTokens, clearTokens } from '../lib/auth-store.js';

// Load tokens (returns null if not logged in)
const tokens = loadTokens();

// Save new tokens
saveTokens({ accessToken, refreshToken, expiresAt });

// Clear tokens (logout)
clearTokens();
```

## Subprocess Execution

For running external commands:

```typescript
import { exec, execCapture } from '../utils/exec.js';

// Run command with inherited stdio (user sees output)
const exitCode = await exec('npm', ['test'], { cwd: '/path/to/dir' });

// Run command and capture output
const { code, stdout, stderr } = await execCapture('docker', ['ps']);
```

## Console Output

Use the output module for consistent formatting:

```typescript
import * as output from '../utils/output.js';

output.info('Information message');     // Cyan
output.success('Success message');      // Green
output.warn('Warning message');         // Yellow
output.error('Error message');          // Red
output.dim('Dimmed text');             // Gray

output.header('Section Title');         // Bold cyan with underline
output.keyValue('Key', 'value');       // "Key: value" format
output.blank();                         // Empty line

output.tableHeader(['COL1', 'COL2'], [20, 30]);
output.tableRow(['value1', 'value2'], [20, 30]);
```

## Input Validation

Use the validators module:

```typescript
import {
  validateEmail,
  sanitizeEmail,
  validateRequired,
  validateUrl,
  normalizeUrl
} from '../lib/validators.js';

// Email validation (for Inquirer prompts)
{
  type: 'input',
  name: 'email',
  validate: validateEmail,  // Returns true or error message
  filter: sanitizeEmail,    // Lowercases and trims
}

// URL validation (for Inquirer prompts)
{
  type: 'input',
  name: 'url',
  validate: validateUrl,    // Validates http/https URLs
  filter: normalizeUrl,     // Removes trailing slash
}

// Manual validation
const emailResult = validateEmail(input);
if (emailResult !== true) {
  output.error(emailResult);
}

const urlResult = validateUrl(input);
if (urlResult !== true) {
  output.error(urlResult);
}
```

## Best Practices

1. **Separation of Concerns**: Keep command logic in `commands/`, UI in `interactive/`
2. **Error Handling**: Always catch errors and use `output.error()` + `process.exit(1)`
3. **JSON Output**: Support `--json` flag for machine-readable output
4. **Confirmation**: Use confirmation prompts for destructive operations
5. **Help Text**: Add examples and descriptions to all commands
6. **Export Functions**: Export command functions for use in interactive mode

## Testing

Commands can be tested by importing and calling the exported functions:

```typescript
import { myAction } from '../commands/myfeature.js';

// Mock the API client
jest.mock('../lib/api-client.js');

test('myAction returns data', async () => {
  mockApiRequest.mockResolvedValue({
    ok: true,
    json: async () => ({ data: 'test' }),
  });

  await myAction({ json: true });
  // Assert output
});
```

## Troubleshooting

### TypeScript Errors

Make sure to use `.js` extensions in imports (required for ESM):

```typescript
// ✓ Correct
import { foo } from './utils/output.js';

// ✗ Wrong
import { foo } from './utils/output';
```

### Command Not Found

Rebuild after changes:

```bash
npm run build
```

### Interactive Mode Issues

If inquirer prompts don't work, ensure stdin is a TTY:

```typescript
if (!process.stdin.isTTY) {
  output.error('Interactive mode requires a terminal');
  process.exit(1);
}
```
