# EnterpriseAppBase CLI (`app`)

A cross-platform CLI for managing the EnterpriseAppBase development environment and interacting with the API.

## Features

- **Configuration** - Configure target server URL (works with any deployed instance)
- **Development Environment** - Start, stop, rebuild Docker services
- **Testing** - Run API tests (Jest), Web tests (Vitest), E2E tests
- **Database** - Prisma migrations, seeding, and Prisma Studio
- **Authentication** - Login via device authorization flow (like GitHub CLI)
- **API Commands** - Manage users, allowlist, and settings
- **Storage** - Upload, download, and manage cloud storage objects
- **Folder Sync** - Synchronize local folders to cloud storage with change detection
- **Interactive Mode** - Menu-driven interface for easy navigation

## Installation

### From Repository Root

```bash
# Install dependencies
npm install

# Build the CLI
cd tools/app && npm run build

# Run via npm script (from repo root)
npm run app start
npm run app --help
```

### Link Globally (Recommended)

```bash
cd tools/app
npm link

# Now you can use 'app' directly from anywhere
app start
app test api watch
app auth login
```

## Quick Start

```bash
# Start development environment
app start

# Or with OpenTelemetry observability
app start --otel

# Check service status
app status

# Run tests
app test

# Open interactive mode
app
```

## Usage Modes

### Interactive Mode

Run `app` with no arguments to launch the interactive menu:

```
$ app

? What would you like to do? (Use arrow keys)
❯ 🚀 Development (start, stop, rebuild...)
  🧪 Testing (run tests, typecheck...)
  🗄️  Database (prisma operations...)
  🔐 Authentication (login, logout...)
  👥 API Commands (users, allowlist...)
  📦 Storage (list, upload, download...)
  🔄 Sync Folder (init, run, status...)
  ⚙️  Settings (API URL, config...)
  ──────────────
  ❌ Exit
```

### Command Mode

Run commands directly:

```bash
app start              # Start all services
app test api watch     # Run API tests in watch mode
app prisma migrate     # Apply database migrations
app auth login         # Authenticate via browser
app allowlist add      # Add email to allowlist
```

## Commands

### Configuration

| Command | Description |
|---------|-------------|
| `app config show` | Show current configuration |
| `app config set-url [url]` | Set App URL (API URL derived automatically) |
| `app config reset` | Reset configuration to defaults |

### Development

| Command | Description |
|---------|-------------|
| `app start [service] [--otel]` | Start all or specific service |
| `app stop [service]` | Stop all or specific service |
| `app restart [service]` | Restart services |
| `app rebuild [service] [--otel]` | Rebuild and restart |
| `app logs [service]` | Follow service logs |
| `app status` | Show service status |
| `app clean` | Stop and remove volumes |

### Testing

| Command | Description |
|---------|-------------|
| `app test` | Run type checks + unit tests |
| `app test all` | Run all tests including E2E |
| `app test typecheck` | Type check only |
| `app test api [mode]` | API tests (watch, coverage, unit, e2e) |
| `app test web [mode]` | Web tests (watch, coverage, ui) |
| `app test e2e` | E2E tests |

### Database (Prisma)

| Command | Description |
|---------|-------------|
| `app prisma generate` | Generate Prisma client |
| `app prisma migrate` | Apply migrations |
| `app prisma migrate status` | Check migration status |
| `app prisma push` | Push schema (dev) |
| `app prisma seed` | Seed database |
| `app prisma studio` | Open Prisma Studio |
| `app prisma reset` | Reset database |

### Authentication

| Command | Description |
|---------|-------------|
| `app auth login` | Login via device flow |
| `app auth test-login <email>` | Test login without OAuth (dev only) |
| `app auth logout` | Clear credentials |
| `app auth status` | Show auth status |
| `app auth whoami` | Show current user |
| `app auth token` | Print access token |

#### Test Authentication (Development Only)

For development and E2E testing, you can bypass OAuth using the test login command:

```bash
# Login as test user with default role (viewer)
app auth test-login test@example.com

# Login as admin
app auth test-login admin@test.local --role admin

# Login as contributor
app auth test-login user@test.local -r contributor
```

**Options:**
- `-r, --role <role>` - Role to assign: `admin`, `contributor`, or `viewer` (default: `viewer`)

**Note:** This command only works when the API is running in development mode (`NODE_ENV !== 'production'`). It is designed for automated testing and local development workflows.

### API Commands

| Command | Description |
|---------|-------------|
| `app health` | Check API health |
| `app users list` | List users (admin) |
| `app users get <id>` | Get user by ID |
| `app allowlist list` | List allowlisted emails |
| `app allowlist add [email]` | Add to allowlist |
| `app allowlist remove <id>` | Remove from allowlist |
| `app settings get` | Get user settings |
| `app settings set <key> <value>` | Update setting |
| `app settings system` | Get system settings |

### Storage

| Command | Description |
|---------|-------------|
| `app storage list` | List storage objects (paginated) |
| `app storage get <id>` | Get object metadata |
| `app storage download <id>` | Get signed download URL |
| `app storage upload <file>` | Upload file to storage |
| `app storage delete <id>` | Delete object |

**Options:**
- `--page, -p` - Page number for list
- `--limit, -l` - Items per page
- `--status` - Filter by status (pending, uploading, processing, ready, failed)
- `--json` - Output as JSON
- `--open` - Open download URL in browser
- `--force` - Delete without confirmation

### Folder Sync

| Command | Description |
|---------|-------------|
| `app sync init <folder>` | Initialize folder for sync |
| `app sync run <folder>` | Synchronize files to cloud |
| `app sync status <folder>` | Show sync status and stats |
| `app sync reset <folder>` | Reset sync tracking |

**Options:**
- `--dry-run` - Preview changes without uploading
- `--verbose` - Show detailed progress
- `--force` - Reset without confirmation

The sync feature uses a local SQLite database (sync.db) to track file state and detect changes.

## Configuration

The CLI can be configured to work with any deployed instance of the application, not just localhost.

### Configuring the Server URL

The CLI needs to know where your application is deployed. You only need to provide the **App URL** - the API URL is automatically derived by appending `/api`.

**Three ways to configure:**

1. **Interactive mode** (Recommended for first-time setup):
   ```bash
   app config set-url
   # Prompts for URL and tests the connection
   ```

2. **Command line**:
   ```bash
   app config set-url https://myapp.com
   ```

3. **Environment variable**:
   ```bash
   export APP_URL=https://myapp.com
   app auth login
   ```

**URL Priority**: Environment variable (`APP_URL`) > Saved config > Default (`http://localhost:3535`)

**Examples:**
```bash
# Configure for production server
app config set-url https://myapp.company.com

# View current configuration
app config show

# Reset to default (localhost)
app config reset
```

### Login Flow URL Prompt

If you try to login without configuring a URL, the CLI will automatically prompt you to enter one:
```bash
$ app auth login
ℹ App URL not configured.

? Enter App URL (e.g., https://myapp.com): https://myapp.company.com
✓ App URL set to: https://myapp.company.com
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_URL` | Application URL | `http://localhost:3535` |
| `APP_API_URL` | API base URL (if different from APP_URL/api) | Derived from `APP_URL` |
| `APP_CONFIG_DIR` | Config directory | `~/.config/app` |
| `APP_NO_EMOJI` | Disable emojis | `0` |

### Configuration Storage

Configuration is stored in `~/.config/app/config.json`:
```json
{
  "appUrl": "https://myapp.company.com"
}
```

### Token Storage

Authentication tokens are stored in `~/.config/app/auth.json` with restricted permissions (owner read/write only).

## Service URLs

After running `app start`:

| Service | URL |
|---------|-----|
| Application | http://localhost:3535 |
| API | http://localhost:3535/api |
| Swagger UI | http://localhost:3535/api/docs |
| API Health | http://localhost:3535/api/health/live |
| Uptrace (with --otel) | http://localhost:14318 |

## Examples

### Working with Remote Servers

```bash
# Configure CLI to connect to staging environment
app config set-url https://staging.myapp.com

# Login to staging
app auth login

# Manage users on staging
app users list
app allowlist add newuser@company.com

# Switch back to local development
app config set-url http://localhost:3535
```

### Complete Development Workflow

```bash
# Start services
app start

# Apply database migrations
app prisma migrate

# Seed initial data
app prisma seed

# Run tests
app test

# View API logs
app logs api

# Stop when done
app stop
```

### Authentication Flow

```bash
# Login (opens browser)
app auth login
# → Opening browser to: http://localhost:3535/device?code=ABCD-1234
# → Your code: ABCD-1234
# → Waiting for authorization...
# → Successfully authenticated as user@example.com

# Check who you are
app auth whoami
# → { "id": "...", "email": "user@example.com", "roles": ["Admin"] }

# Make API calls
app users list
app allowlist add new@example.com --notes "New team member"

# Logout
app auth logout
```

### Test Authentication (Development)

For automated testing or quick local development without OAuth:

```bash
# Quick admin login for testing
app auth test-login admin@test.local --role admin
# → ℹ Logging in as test user: admin@test.local (admin)
# → ✓ Logged in as admin@test.local with role: admin
# → Email:   admin@test.local
# → Roles:   admin

# Verify login
app auth whoami

# Now run commands as admin
app users list
```

### Interactive Allowlist Management

```bash
$ app allowlist add

? Email address to allowlist: newuser@company.com
? Notes (optional): Added for Q1 onboarding
? Add newuser@company.com to allowlist? Yes
✓ Added newuser@company.com to allowlist
```

### Storage Examples

```bash
# Upload a file
app storage upload ./document.pdf

# List all ready files
app storage list --status ready

# Download a file (opens in browser)
app storage download abc123 --open
```

### Folder Sync Examples

```bash
# Initialize a folder for syncing
app sync init ./my-project

# Preview what would be synced
app sync run ./my-project --dry-run

# Sync files to cloud
app sync run ./my-project --verbose

# Check sync status
app sync status ./my-project
```

## Development

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for information on extending the CLI.

## Troubleshooting

### "API container is not running"

Start the services first:
```bash
app start
```

### "Not authenticated"

Login first:
```bash
app auth login
```

### "Session expired"

Your token has expired. Login again:
```bash
app auth login
```

### Commands not found after `npm link`

Make sure npm's bin directory is in your PATH:
```bash
# Check where npm installs global binaries
npm config get prefix

# Add to PATH if needed (Windows PowerShell)
$env:PATH += ";$(npm config get prefix)"
```

## License

MIT
