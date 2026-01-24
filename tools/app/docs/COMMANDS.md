# Command Reference

Complete reference for all EnterpriseAppBase CLI commands.

## Global Options

| Option | Description |
|--------|-------------|
| `-i, --interactive` | Force interactive mode |
| `-V, --version` | Show version number |
| `-h, --help` | Show help |

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

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `APP_API_URL` | API base URL | `http://localhost:3535/api` |
| `APP_URL` | Application URL | `http://localhost:3535` |
| `APP_CONFIG_DIR` | Config directory | `~/.config/app` |
| `APP_NO_EMOJI` | Disable emojis (set to `1`) | `0` |
