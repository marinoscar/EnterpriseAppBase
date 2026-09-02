# Enterprise Application Foundation

[![CI](https://github.com/marinoscar/EnterpriseAppBase/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/marinoscar/EnterpriseAppBase/actions/workflows/ci.yml)

A production-grade full-stack application foundation built with React, NestJS, and PostgreSQL. Features OAuth authentication, role-based access control, and comprehensive observability.

## Features

- **Authentication**: Google OAuth 2.0 with JWT access tokens and refresh token rotation
- **Device Authorization**: RFC 8628 Device Authorization Flow for CLI tools, mobile apps, and IoT devices
- **Authorization**: Role-Based Access Control (RBAC) with three roles (Admin, Contributor, Viewer)
- **Access Control**: Email allowlist restricts application access to pre-authorized users
- **User Management**: Admin interface for managing users, role assignments, and allowlist
- **Settings Framework**: System-wide and per-user settings with type-safe schemas
- **Notifications**: In-app (live SSE stream + notification centre) and email delivery, driven by a single event registry
- **Personal Access Tokens**: Long-lived, revocable tokens for headless/API access
- **Storage**: Resumable multipart and simple file uploads, backed by S3-compatible storage
- **Email/SMTP Configuration**: Admin-managed email settings with an encrypted credential store
- **`appctl` CLI**: First-party command-line client (login, generic API calls, and VPS deployment) — see [`apps/cli/README.md`](apps/cli/README.md)
- **Observability**: OpenTelemetry instrumentation with traces, metrics, and structured logging
- **API Documentation**: Swagger/OpenAPI documentation at `/api/docs`
- **Same-Origin Architecture**: Frontend and API served from same host via Nginx reverse proxy

## Technology Stack

### Backend
- **Framework**: NestJS with Fastify adapter
- **Database**: PostgreSQL with Prisma ORM
- **Authentication**: Passport.js (Google OAuth)
- **Observability**: OpenTelemetry + Uptrace
- **Testing**: Jest + Supertest

### Frontend
- **Framework**: React 19 with TypeScript
- **UI Library**: Material-UI (MUI)
- **State Management**: React Context API
- **Testing**: Vitest + React Testing Library
- **Build Tool**: Vite

### Infrastructure
- **Containerization**: Docker + Docker Compose
- **Reverse Proxy**: Nginx
- **Database**: PostgreSQL 16

## Prerequisites

- Node.js 24+ (see `.nvmrc`; enforced by the `engines` field)
- Docker Desktop
- Google OAuth credentials (from [Google Cloud Console](https://console.cloud.google.com))

## Quick Start

### 1. Clone and Configure

```bash
git clone <repository-url>
cd EnterpriseAppBase

# Set up environment variables
cd infra/compose
cp .env.example .env
```

### 2. Configure Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project (or select existing)
3. Enable Google+ API
4. Create OAuth 2.0 credentials
5. Add authorized redirect URI: `http://localhost:3535/api/auth/google/callback`
6. Copy Client ID and Client Secret to `.env`:

```bash
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
```

### 3. Start Application

```bash
# From infra/compose directory
docker compose -f base.compose.yml -f dev.compose.yml up
```

### 4. Seed Database (CRITICAL - Must run before first login)

```bash
# In a new terminal
docker compose exec api sh
cd /app/apps/api
npx tsx prisma/seed.ts
exit
```

**Why seeding is required:**
- Creates RBAC roles (admin, contributor, viewer)
- Creates permissions (users:read, users:write, etc.)
- Without seeds, first login will fail with "Default role not found"

### 5. Access Application

- **Frontend**: http://localhost:3535
- **API**: http://localhost:3535/api
- **Swagger Docs**: http://localhost:3535/api/docs

### 6. First Login

The first user to login with email matching `INITIAL_ADMIN_EMAIL` (from `.env`) will automatically be granted the **admin** role. All subsequent users get **viewer** role by default.

**Important:** Only email addresses in the **allowlist** can login. The `INITIAL_ADMIN_EMAIL` is automatically added to the allowlist during seeding. After your first login as admin, use the Admin Panel to manage the allowlist.

## Development

### Running with Observability Stack

To enable full observability (Uptrace UI for traces, metrics, logs):

```bash
cd infra/compose
docker compose -f base.compose.yml -f dev.compose.yml -f otel.compose.yml up
```

Access Uptrace UI at: http://localhost:14318

### Running Tests

**Backend Tests:**
```bash
cd apps/api
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:cov      # With coverage
npm run test:e2e      # E2E tests only
```

**Frontend Tests:**
```bash
cd apps/web
npm test              # Run all tests
npm run test:watch    # Watch mode
npm run test:coverage # With coverage
```

**E2E Tests (Playwright):**
```bash
cd tests/e2e
npm install              # First time setup
npx playwright install   # Install browsers
npm test                 # Run E2E tests
npm run test:ui          # Run with visual UI
```

Note: E2E tests use a test authentication bypass (`/testing/login`) that is only available in development/test environments. See [TESTING.md](docs/TESTING.md#e2e-testing-with-playwright) for details.

### Database Migrations

```bash
cd apps/api

# Create a new migration
npx prisma migrate dev --name migration_name

# Apply migrations
npx prisma migrate deploy

# Generate Prisma Client
npx prisma generate
```

### Hot Reload

Development mode (`dev.compose.yml`) includes hot reload for both frontend and backend:
- Backend: Changes to `apps/api/src/**` trigger restart
- Frontend: Vite HMR updates immediately

## Project Structure

```
EnterpriseAppBase/
├── apps/
│   ├── api/                    # Backend API (NestJS + Fastify)
│   │   ├── src/
│   │   │   ├── auth/          # Authentication & authorization
│   │   │   ├── users/         # User management
│   │   │   ├── settings/      # Settings endpoints
│   │   │   └── prisma/        # Database service
│   │   ├── prisma/
│   │   │   ├── schema.prisma  # Database schema
│   │   │   ├── seed.ts        # Database seeds
│   │   │   └── migrations/    # Migration history
│   │   └── test/              # Integration tests
│   ├── web/                    # Frontend (React + MUI)
│   │   ├── src/
│   │   │   ├── components/    # Reusable components
│   │   │   ├── contexts/      # React contexts (Auth, Theme)
│   │   │   ├── pages/         # Page components
│   │   │   └── services/      # API client
│   │   └── src/__tests__/     # Component tests
│   └── cli/                    # `appctl` CLI (Commander + ink)
│       ├── src/
│       │   ├── commands/      # `login`, `api`, `config`, `deploy` subcommands
│       │   └── tui/           # Interactive ink menu (real terminals only)
│       └── README.md          # CLI usage, install, CI setup, VPS deploy
├── packages/
│   └── shared/                 # `@app/shared` — cross-app constants (e.g. APP_NAME); see its README to rebrand a fork
├── docs/                       # Documentation
│   ├── DEVELOPMENT.md         # Development guide (start here!)
│   ├── ARCHITECTURE.md        # System architecture
│   ├── SECURITY-ARCHITECTURE.md  # Security design
│   ├── TESTING.md             # Testing guide
│   ├── deployment/            # Operator runbooks (e.g. VPS deploy)
│   ├── runbooks/              # Operational runbooks (e.g. secrets key rotation)
│   └── specs/                 # Living design decision records
├── infra/
│   ├── compose/               # Docker Compose configs
│   │   ├── base.compose.yml   # Core services
│   │   ├── dev.compose.yml    # Development overrides
│   │   ├── prod.compose.yml   # Production overrides
│   │   ├── test.compose.yml   # Test database for CI/local test runs
│   │   ├── vps.compose.yml    # VPS overrides (shared host reverse proxy)
│   │   └── otel.compose.yml   # Observability stack
│   ├── nginx/                 # Nginx config
│   └── otel/                  # OpenTelemetry config
├── tests/                      # E2E (Playwright) and visual regression suites
├── scripts/                     # Repo-level dev scripts
├── install.sh                  # `appctl` installer (curl | bash)
└── CLAUDE.md                  # AI assistant guidance
```

## Documentation

- **[DEVELOPMENT.md](docs/DEVELOPMENT.md)** - Development setup, common patterns, and troubleshooting
- **[ARCHITECTURE.md](docs/ARCHITECTURE.md)** - System architecture and design
- **[SECURITY-ARCHITECTURE.md](docs/SECURITY-ARCHITECTURE.md)** - Security design and implementation
- **[TESTING.md](docs/TESTING.md)** - Testing strategy and best practices
- **[DEVICE-AUTH.md](docs/DEVICE-AUTH.md)** - Device Authorization Flow guide and integration examples
- **[personal-access-tokens.md](docs/personal-access-tokens.md)** - Personal access tokens: creation, use, and revocation
- **[API.md](docs/API.md)** - Complete API reference
- **[appctl CLI](apps/cli/README.md)** - The first-party command-line client: install, login, generic API calls, and CI usage
- **[Deploying to a VPS](docs/deployment/vps.md)** - Operator runbook for `appctl deploy` (install, update, status on a real server); command reference in [`apps/cli/README.md`](apps/cli/README.md#deploying-to-a-server)
- **[Rotating the secrets encryption key](docs/runbooks/rotate-secrets-encryption-key.md)** - Runbook for rotating `SECRETS_ENCRYPTION_KEY`
- **[Rebranding a fork](packages/shared/README.md)** - How to rename the app for a fork by editing one constant
- **[Design Decision Records](docs/specs/)** - Living records of specific design decisions (settings UI, navigation IA, the shared DataTable, API documentation, VPS deploy) — what was chosen, what was rejected, and why

## API Documentation

Interactive API documentation is available at `/api/docs` when running the application.

### Key Endpoints

**Authentication:**
- `GET /api/auth/providers` - List OAuth providers
- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/me` - Get current user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout

**Device Authorization (RFC 8628):**
- `POST /api/auth/device/code` - Generate device code for CLI/IoT devices
- `POST /api/auth/device/token` - Poll for device authorization
- `GET /api/auth/device/sessions` - List authorized devices
- `DELETE /api/auth/device/sessions/:id` - Revoke device access

**Users (Admin only):**
- `GET /api/users` - List users
- `GET /api/users/:id` - Get user by ID
- `PATCH /api/users/:id` - Update user

**Allowlist (Admin only):**
- `GET /api/allowlist` - List allowlisted emails
- `POST /api/allowlist` - Add email to allowlist
- `DELETE /api/allowlist/:id` - Remove email from allowlist

**Settings:**
- `GET /api/user-settings` - Get user settings
- `PUT /api/user-settings` - Update user settings
- `GET /api/system-settings` - Get system settings (Admin)
- `PUT /api/system-settings` - Update system settings (Admin)

**Personal Access Tokens:**
- `POST /api/pat` - Create a personal access token
- `GET /api/pat` - List current user's tokens
- `DELETE /api/pat/:id` - Revoke a token

**Notifications:**
- `GET /api/notifications/events` - List the notification event registry
- `GET /api/notifications/stream` - Live notification stream (SSE)
- `GET /api/notifications` - List current user's notifications
- `GET /api/notifications/unread-count` - Unread notification count
- `POST /api/notifications/:id/read` - Mark a notification read

**Email Settings (Admin):**
- `GET /api/email-settings` - Get SMTP/email configuration
- `PUT /api/email-settings` - Update SMTP/email configuration
- `POST /api/email-settings/test` - Send a test email

**Storage Objects:**
- `POST /api/storage/objects` - Upload a file
- `GET /api/storage/objects` - List objects
- `GET /api/storage/objects/:id` - Get object metadata
- `GET /api/storage/objects/:id/download` - Get a signed download URL
- `DELETE /api/storage/objects/:id` - Delete an object

**Health:**
- `GET /api/health/live` - Liveness probe
- `GET /api/health/ready` - Readiness probe

## Environment Variables

Key configuration (see `infra/compose/.env.example` for full list):

```bash
# Application
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3535
# Loopback port bound behind a shared host proxy (infra/compose/vps.compose.yml only)
APP_BIND_PORT=3535

# Database (DATABASE_URL is constructed from these at runtime)
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=appdb
POSTGRES_SSL=false

# JWT / Session
JWT_SECRET=your-secret-min-32-chars
JWT_ACCESS_TTL_MINUTES=15
JWT_REFRESH_TTL_DAYS=14
COOKIE_SECRET=your-cookie-secret-min-32-chars

# Credential encryption (runtime-configured secrets, e.g. SMTP password)
SECRETS_ENCRYPTION_KEY=

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3535/api/auth/google/callback

# Admin Bootstrap
INITIAL_ADMIN_EMAIL=admin@example.com

# Device Authorization Flow (RFC 8628)
DEVICE_CODE_EXPIRY_MINUTES=15
DEVICE_CODE_POLL_INTERVAL=5
DEVICE_TOKEN_EXPIRY_DAYS=7
DEVICE_PAT_EXPIRY_DAYS=90

# Storage (S3-compatible)
STORAGE_PROVIDER=s3
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
MAX_FILE_SIZE=10737418240
ALLOWED_MIME_TYPES=image/*,application/pdf,video/*
SIGNED_URL_EXPIRY=3600
STORAGE_PART_SIZE=10485760

# Observability
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
OTEL_SERVICE_NAME=enterprise-app-api
LOG_LEVEL=info

# Uptrace (when using otel.compose.yml) - the values below are
# development-only defaults from .env.example. Change them before running
# the observability stack anywhere other than local development.
UPTRACE_SECRET_KEY=change-me-in-production-1234567890abcdef
UPTRACE_PROJECT1_TOKEN=project1_secret_token
UPTRACE_ADMIN_PASSWORD=admin
UPTRACE_PGPASSWORD=uptrace
```

## Important Notes for Developers

### NestJS with Fastify (Not Express)

This application uses **Fastify** as the HTTP adapter, not Express. Key differences:

**Response methods:**
- ✅ Fastify: `res.code(200).send(data)`
- ❌ Express: `res.status(200).json(data)`

**Best practice:** Let NestJS handle responses automatically (don't use `@Res()` decorator).

See [DEVELOPMENT.md](docs/DEVELOPMENT.md) for detailed guidance.

### Database Seeding is Required

Before your first login, you MUST seed the database:

```bash
docker compose exec api sh
cd /app/apps/api
npx tsx prisma/seed.ts
```

This creates roles, permissions, and default settings. Without seeding, OAuth login will fail.

### OAuth with Fastify

Passport OAuth strategies expect Express-style objects. The `GoogleOAuthGuard` handles compatibility by returning raw Node.js request/response objects to Passport. See [SECURITY-ARCHITECTURE.md](docs/SECURITY-ARCHITECTURE.md) for details.

## Troubleshooting

### "Default role not found" error
**Solution:** Run database seeds (see step 4 in Quick Start)

### "Email not authorized" error during login
**Solution:** The email must be in the allowlist. If you're the first admin:
1. Ensure your email matches `INITIAL_ADMIN_EMAIL` in `.env` exactly
2. Restart containers to apply environment variable changes
3. Re-run database seeds if needed

If you're not the first admin, ask an existing admin to add your email to the allowlist at `/admin/users` (Allowlist tab).

### OAuth redirect fails
**Solution:**
1. Verify `GOOGLE_CALLBACK_URL` matches Google Cloud Console exactly
2. Check container logs: `docker compose logs api -f`

### Database connection error
**Solution:**
1. Ensure containers are running: `docker compose ps`
2. Verify the `POSTGRES_HOST`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD`, and `POSTGRES_DB` values in `.env` point to a reachable PostgreSQL instance (the compose stack no longer bundles a `db` service, so PostgreSQL must be running separately)
3. Restart the API container: `docker compose restart api`

### Port already in use
**Solution:** Change `PORT` in `.env` or stop conflicting service

For more troubleshooting, see [DEVELOPMENT.md](docs/DEVELOPMENT.md#debugging-tips).

## Production Deployment

Deploying to a real VPS is handled entirely by the `appctl` CLI —
`appctl deploy doctor|install|update|status` — run on the server itself.
There is no separate deploy script or playbook. See
[docs/deployment/vps.md](docs/deployment/vps.md) for the operator runbook
(prerequisites, first login, troubleshooting) and
[`apps/cli/README.md`](apps/cli/README.md#deploying-to-a-server) for the
command reference (flags, exit codes).

See [SECURITY-ARCHITECTURE.md](docs/SECURITY-ARCHITECTURE.md) for the production security checklist.

## Contributing

1. Fork the repository
2. Create a feature branch
3. Write tests for new features
4. Ensure all tests pass
5. Update documentation
6. Submit pull request

## Architecture Decisions

- **Fastify over Express**: 2-3x better performance, better TypeScript support
- **Prisma**: Type-safe ORM with excellent migration tooling
- **Same-origin hosting**: Simplifies security, no CORS complexity
- **JWT + Refresh tokens**: Short-lived access tokens with secure refresh rotation
- **RBAC**: Flexible permission system for future feature expansion
- **OpenTelemetry**: Vendor-neutral observability
- **Docker Compose**: Reproducible local development environment

## License

[Your License Here]

## Support

For issues, questions, or contributions:
- Review [DEVELOPMENT.md](docs/DEVELOPMENT.md) for common issues
- Check [documentation](docs/) for detailed guides
- Submit issues via GitHub Issues
- Contact the team

---

**Happy coding!** 🚀