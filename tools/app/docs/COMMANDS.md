# Command Reference

Complete reference for all EnterpriseAppBase CLI commands.

## Global Options

| Option | Description |
|--------|-------------|
| `-i, --interactive` | Force interactive mode |
| `-V, --version` | Show version number |
| `-h, --help` | Show help |

---

## Configuration Commands

### app config show

Show current CLI configuration (App URL, API URL, and source).

```
Usage: app config show
```

**Output:**
- App URL (where the application is hosted)
- API URL (derived from App URL)
- Configuration source (environment, config file, or default)

**Examples:**
```bash
app config show
```

**Sample Output:**
```
CLI Configuration

App URL: https://myapp.company.com
API URL: https://myapp.company.com/api (derived)

(URL from saved configuration)
```

### app config set-url

Configure the App URL. The API URL is automatically derived by appending `/api`.

```
Usage: app config set-url [url]

Arguments:
  url    App URL (optional, prompts if not provided)
```

**Interactive mode** (no url argument):
- Prompts for URL with validation
- Tests connection to the server
- Confirms before saving

**Features:**
- URL validation and normalization
- Automatic connection test to `/api/health/live`
- Saves even if connection fails (useful for configuring before starting server)

**Examples:**
```bash
app config set-url                          # Interactive with prompts
app config set-url https://myapp.com        # Direct command
app config set-url http://localhost:3535    # Set to default
```

### app config reset

Reset configuration to defaults (localhost).

```
Usage: app config reset
```

Prompts for confirmation before proceeding. After reset:
- App URL: `http://localhost:3535`
- API URL: `http://localhost:3535/api`

**Example:**
```bash
app config reset
```

---

## Development Commands

### app start

Start Docker services.

```
Usage: app start [service] [options]

Arguments:
  service    Specific service (api, web, db, nginx)

Options:
  --otel     Include OpenTelemetry observability stack
```

**Examples:**
```bash
app start              # Start all services
app start api          # Start only API
app start --otel       # Start with observability
app start api --otel   # Start API with observability
```

### app stop

Stop Docker services.

```
Usage: app stop [service]

Arguments:
  service    Specific service to stop
```

**Examples:**
```bash
app stop               # Stop all services
app stop api           # Stop only API
```

### app restart

Restart Docker services.

```
Usage: app restart [service]

Arguments:
  service    Specific service to restart
```

### app rebuild

Rebuild and restart Docker services with `--no-cache`.

```
Usage: app rebuild [service] [options]

Arguments:
  service    Specific service to rebuild

Options:
  --otel     Include OpenTelemetry stack
```

**Examples:**
```bash
app rebuild            # Rebuild all services
app rebuild api        # Rebuild only API
```

### app logs

Show Docker logs in follow mode.

```
Usage: app logs [service]

Arguments:
  service    Specific service (api, web, db, nginx)
```

**Examples:**
```bash
app logs               # All services
app logs api           # API only
```

### app status

Show status of all Docker services.

```
Usage: app status
```

### app clean

Stop all services and remove volumes. **Destroys all data!**

```
Usage: app clean
```

Prompts for confirmation before proceeding.

---

## Test Commands

### app test

Run tests.

```
Usage: app test [target] [mode]

Arguments:
  target    Test target (api, web, all, coverage, e2e, typecheck)
  mode      Test mode (watch, coverage, ui, unit, e2e)
```

**Examples:**
```bash
app test               # Type checks + API + Web tests
app test all           # Everything including E2E
app test typecheck     # Type check only

# API tests
app test api           # Run once
app test api watch     # Watch mode
app test api coverage  # With coverage
app test api unit      # Unit tests only
app test api e2e       # E2E tests only

# Web tests
app test web           # Run once
app test web watch     # Watch mode
app test web coverage  # With coverage
app test web ui        # Open Vitest UI
```

---

## Database Commands (Prisma)

All Prisma commands run inside the Docker API container (except `studio`).

### app prisma generate

Generate Prisma client after schema changes.

```
Usage: app prisma generate
```

### app prisma migrate

Apply pending database migrations.

```
Usage: app prisma migrate [option]

Options:
  status    Check migration status instead of applying
  deploy    Apply in production mode
```

**Examples:**
```bash
app prisma migrate          # Apply migrations
app prisma migrate status   # Check status
app prisma migrate deploy   # Production mode
```

### app prisma push

Push schema changes directly to database (development only, no migration file).

```
Usage: app prisma push
```

### app prisma studio

Open Prisma Studio GUI. Runs locally (not in Docker) to allow browser access.

```
Usage: app prisma studio
```

Opens at: http://localhost:5555

### app prisma seed

Run database seed script.

```
Usage: app prisma seed
```

### app prisma reset

Reset database and delete all data. **Destructive operation!**

```
Usage: app prisma reset
```

Prompts for confirmation before proceeding.

---

## Authentication Commands

### app auth login

Authenticate using device authorization flow. Opens browser for approval.

```
Usage: app auth login
```

**Flow:**
1. CLI requests device code from API
2. Browser opens to verification URL
3. User approves in browser
4. CLI polls until approved
5. Tokens stored locally

### app auth logout

Clear stored credentials.

```
Usage: app auth logout
```

### app auth status

Show current authentication status.

```
Usage: app auth status
```

**Output:**
- Authentication status
- Email address
- Roles
- Token expiration

### app auth whoami

Get current user info from API (`/api/auth/me`).

```
Usage: app auth whoami
```

### app auth token

Print current access token. Useful for debugging or piping to other commands.

```
Usage: app auth token
```

**Example:**
```bash
curl -H "Authorization: Bearer $(app auth token)" http://localhost:3535/api/users
```

---

## User Commands

Admin-only commands for user management.

### app users list

List all users.

```
Usage: app users list [options]

Options:
  -p, --page <number>   Page number (default: 1)
  -l, --limit <number>  Items per page (default: 20)
  --json                Output as JSON
```

**Output columns:**
- ID
- EMAIL
- ROLES
- ACTIVE

### app users get

Get a user by ID.

```
Usage: app users get <id> [options]

Arguments:
  id         User ID (UUID)

Options:
  --json     Output as JSON
```

---

## Allowlist Commands

Admin-only commands for managing the email allowlist.

### app allowlist list

List all allowlisted emails.

```
Usage: app allowlist list [options]

Options:
  -p, --page <number>   Page number (default: 1)
  -l, --limit <number>  Items per page (default: 20)
  --json                Output as JSON
```

**Output columns:**
- EMAIL
- STATUS (pending, claimed)
- NOTES
- ADDED

### app allowlist add

Add an email to the allowlist.

```
Usage: app allowlist add [email] [options]

Arguments:
  email              Email address (optional, prompts if not provided)

Options:
  -n, --notes <text>  Optional notes
```

**Interactive mode** (no email argument):
- Prompts for email with validation
- Prompts for optional notes
- Confirms before adding

**Examples:**
```bash
app allowlist add                              # Interactive
app allowlist add user@example.com             # Direct
app allowlist add user@example.com -n "Notes"  # With notes
```

**Validation:**
- Email must be valid format
- Email is lowercased and trimmed

### app allowlist remove

Remove an email from the allowlist.

```
Usage: app allowlist remove <id>

Arguments:
  id    Allowlist entry ID (UUID)
```

---

## Settings Commands

### app settings get

Get current user's settings.

```
Usage: app settings get [options]

Options:
  --json    Output as JSON
```

### app settings set

Update a user setting.

```
Usage: app settings set <key> <value>

Arguments:
  key      Setting key
  value    Setting value (JSON or string)
```

**Examples:**
```bash
app settings set theme dark
app settings set notifications '{"email": true, "push": false}'
```

### app settings system

Get system settings (admin only).

```
Usage: app settings system [options]

Options:
  --json    Output as JSON
```

---

## Health Commands

### app health

Check API health status.

```
Usage: app health [options]

Options:
  --json    Output as JSON
```

**Checks:**
- Liveness (`/api/health/live`)
- Readiness (`/api/health/ready`)

---

## Interactive Mode

### app (no arguments)

Launch interactive menu.

```
Usage: app
       app -i
       app --interactive
```

**Main Menu:**
- Development (start, stop, rebuild...)
- Testing (run tests, typecheck...)
- Database (prisma operations...)
- Authentication (login, logout...)
- API Commands (users, allowlist...)
- Settings (API URL, config...)
- Exit

**Navigation:**
- Use arrow keys to navigate
- Press Enter to select
- Select "Back" to return to previous menu
- Select "Exit" to quit

---

## Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | Error (check output for details) |

---

## Configuration Details

### URL Configuration Priority

The CLI determines which server to connect to using this priority order:

1. **Environment variable** `APP_URL` (highest priority)
2. **Saved configuration** in `~/.config/app/config.json`
3. **Default** `http://localhost:3535` (lowest priority)

### Configuration File

Configuration is stored in `~/.config/app/config.json`:

```json
{
  "appUrl": "https://myapp.company.com"
}
```

The file has restricted permissions (owner read/write only, `0600`).

### URL Derivation

The CLI only stores the **App URL**. The **API URL** is automatically derived:

- **App URL**: `https://myapp.com` (what you configure)
- **API URL**: `https://myapp.com/api` (automatically derived)

This matches the same-origin routing pattern where the web UI is served at `/` and the API at `/api`.

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_URL` | Application URL (takes precedence over saved config) | `http://localhost:3535` |
| `APP_API_URL` | API base URL (overrides derived URL if set) | Derived from `APP_URL` |
| `APP_CONFIG_DIR` | Config directory location | `~/.config/app` |
| `APP_NO_EMOJI` | Disable emojis (set to `1`) | `0` |

### Multi-Environment Setup

You can use environment variables to quickly switch between environments:

```bash
# Local development (default)
app auth login

# Staging environment
APP_URL=https://staging.myapp.com app auth login

# Production environment
APP_URL=https://myapp.com app users list
```

Or configure persistently for the environment you use most:

```bash
# Set to staging
app config set-url https://staging.myapp.com

# All commands now target staging by default
app auth login
app users list

# Override temporarily with env var for production
APP_URL=https://myapp.com app users list
```
