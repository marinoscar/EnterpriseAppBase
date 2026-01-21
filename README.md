# Enterprise Application Foundation

A production-grade full-stack application foundation built with React, NestJS, and PostgreSQL. Features OAuth authentication, role-based access control, and comprehensive observability.

## Features

- **Authentication**: Google OAuth 2.0 with JWT access tokens and refresh token rotation
- **Authorization**: Role-Based Access Control (RBAC) with three roles (Admin, Contributor, Viewer)
- **User Management**: Admin interface for managing users and role assignments
- **Settings Framework**: System-wide and per-user settings with type-safe schemas
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
- **Framework**: React 18 with TypeScript
- **UI Library**: Material-UI (MUI)
- **State Management**: React Context API
- **Testing**: Vitest + React Testing Library
- **Build Tool**: Vite

### Infrastructure
- **Containerization**: Docker + Docker Compose
- **Reverse Proxy**: Nginx
- **Database**: PostgreSQL 16

## Prerequisites

- Node.js 18+
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
│   └── web/                    # Frontend (React + MUI)
│       ├── src/
│       │   ├── components/    # Reusable components
│       │   ├── contexts/      # React contexts (Auth, Theme)
│       │   ├── pages/         # Page components
│       │   └── services/      # API client
│       └── src/__tests__/     # Component tests
├── docs/                       # Documentation
│   ├── DEVELOPMENT.md         # Development guide (start here!)
│   ├── SECURITY-ARCHITECTURE.md  # Security design
│   ├── TESTING.md             # Testing guide
│   └── specs/                 # Feature specifications
├── infra/
│   ├── compose/               # Docker Compose configs
│   │   ├── base.compose.yml   # Core services
│   │   ├── dev.compose.yml    # Development overrides
│   │   ├── prod.compose.yml   # Production overrides
│   │   └── otel.compose.yml   # Observability stack
│   ├── nginx/                 # Nginx config
│   └── otel/                  # OpenTelemetry config
└── CLAUDE.md                  # AI assistant guidance
```

## Documentation

- **[DEVELOPMENT.md](docs/DEVELOPMENT.md)** - Development setup, common patterns, and troubleshooting
- **[SECURITY-ARCHITECTURE.md](docs/SECURITY-ARCHITECTURE.md)** - Security design and implementation
- **[TESTING.md](docs/TESTING.md)** - Testing strategy and best practices
- **[System Specification](docs/System_Specification_Document.md)** - Complete project specification
- **[Feature Specs](docs/specs/)** - Individual feature specifications

## API Documentation

Interactive API documentation is available at `/api/docs` when running the application.

### Key Endpoints

**Authentication:**
- `GET /api/auth/providers` - List OAuth providers
- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/me` - Get current user
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout

**Users (Admin only):**
- `GET /api/users` - List users
- `GET /api/users/:id` - Get user by ID
- `PATCH /api/users/:id` - Update user

**Settings:**
- `GET /api/user-settings` - Get user settings
- `PUT /api/user-settings` - Update user settings
- `GET /api/system-settings` - Get system settings (Admin)
- `PUT /api/system-settings` - Update system settings (Admin)

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

# Database
DATABASE_URL=postgresql://postgres:postgres@db:5432/appdb

# JWT
JWT_SECRET=your-secret-min-32-chars
JWT_ACCESS_TTL_MINUTES=15
JWT_REFRESH_TTL_DAYS=14

# Google OAuth
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3535/api/auth/google/callback

# Admin Bootstrap
INITIAL_ADMIN_EMAIL=admin@example.com

# Observability
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
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

Passport OAuth strategies expect Express-style objects. The `GoogleOAuthGuard` handles compatibility by returning raw Node.js request/response objects to Passport. See [SECURITY-ARCHITECTURE.md](docs/SECURITY-ARCHITECTURE.md#9-implementation-notes-fastify--passport-oauth) for details.

## Troubleshooting

### "Default role not found" error
**Solution:** Run database seeds (see step 4 in Quick Start)

### OAuth redirect fails
**Solution:**
1. Verify `GOOGLE_CALLBACK_URL` matches Google Cloud Console exactly
2. Check container logs: `docker compose logs api -f`

### Database connection error
**Solution:**
1. Ensure containers are running: `docker compose ps`
2. Check `DATABASE_URL` in `.env`
3. Restart: `docker compose restart db`

### Port already in use
**Solution:** Change `PORT` in `.env` or stop conflicting service

For more troubleshooting, see [DEVELOPMENT.md](docs/DEVELOPMENT.md#debugging-tips).

## Production Deployment

For production deployment:

1. Use `prod.compose.yml` overrides
2. Set `NODE_ENV=production`
3. Use strong secrets (generate with `openssl rand -base64 32`)
4. Enable HTTPS with valid certificates
5. Set `secure: true` on cookies
6. Configure proper OAuth callback URLs
7. Set up database backups
8. Configure monitoring and alerting

See [SECURITY-ARCHITECTURE.md](docs/SECURITY-ARCHITECTURE.md) for production security checklist.

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
