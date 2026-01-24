# EnterpriseAppBase CLI (`app`)

A cross-platform CLI for managing the EnterpriseAppBase development environment and interacting with the API.

## Features

- **Development Environment** - Start, stop, rebuild Docker services
- **Testing** - Run API tests (Jest), Web tests (Vitest), E2E tests
- **Database** - Prisma migrations, seeding, and Prisma Studio
- **Authentication** - Login via device authorization flow (like GitHub CLI)
- **API Commands** - Manage users, allowlist, and settings
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
| `app auth logout` | Clear credentials |
| `app auth status` | Show auth status |
| `app auth whoami` | Show current user |
| `app auth token` | Print access token |

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

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_API_URL` | API base URL | `http://localhost:3535/api` |
| `APP_URL` | Application URL | `http://localhost:3535` |
| `APP_CONFIG_DIR` | Config directory | `~/.config/app` |
| `APP_NO_EMOJI` | Disable emojis | `0` |

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

### Interactive Allowlist Management

```bash
$ app allowlist add

? Email address to allowlist: newuser@company.com
? Notes (optional): Added for Q1 onboarding
? Add newuser@company.com to allowlist? Yes
✓ Added newuser@company.com to allowlist
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
