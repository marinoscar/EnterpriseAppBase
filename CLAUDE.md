# CLAUDE.md

This file provides guidance for AI assistants working on this codebase.

## Project Overview

Web Application Foundation with React UI + Node API + PostgreSQL. Production-grade foundation with OAuth authentication, RBAC authorization, and flexible settings framework.

## Technology Stack

- **Backend**: Node.js + TypeScript, NestJS with Fastify adapter
- **Frontend**: React + TypeScript, Material UI (MUI)
- **Database**: PostgreSQL with Prisma ORM
- **Auth**: Passport strategies (Google OAuth required)
- **Testing**: Jest + Supertest (backend), React Testing Library + Jest (frontend)
- **Observability**: OpenTelemetry, Pino structured logging
- **Containerization**: Docker + Docker Compose

## Repository Structure

```
/
  apps/
    api/                    # Backend API
      src/
      test/
      prisma/
        schema.prisma
        migrations/
    web/                    # Frontend React app
      src/
      src/__tests__/
  docs/                     # Documentation
  tests/e2e/                # Optional E2E tests
  docker-compose.yml
  .env.example
```

## Architecture Principles

1. **Separation of Concerns**: UI handles presentation only; API handles all business logic and authorization
2. **Same-Origin Hosting**: UI at `/`, API at `/api`, Swagger at `/api/docs`
3. **Security by Default**: All API endpoints require authentication unless explicitly public
4. **API-First**: All business logic resides in the API layer

## Key Commands

```bash
# Start local development environment
docker compose up

# Run API tests
cd apps/api && npm test

# Run frontend tests
cd apps/web && npm test

# Generate Prisma client after schema changes
cd apps/api && npx prisma generate

# Create a new migration
cd apps/api && npx prisma migrate dev --name <migration_name>

# Apply migrations
cd apps/api && npx prisma migrate deploy
```

## API Endpoints (MVP)

### Authentication
- `GET /api/auth/providers` - List enabled OAuth providers
- `GET /api/auth/google` - Initiate Google OAuth
- `GET /api/auth/google/callback` - OAuth callback
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout and invalidate session
- `GET /api/auth/me` - Get current user

### Users (Admin-only)
- `GET /api/users` - List users (paginated)
- `GET /api/users/{id}` - Get user by ID
- `PATCH /api/users/{id}` - Update user (roles, activation)

### Settings
- `GET /api/user-settings` - Get current user's settings
- `PUT /api/user-settings` - Replace user settings
- `PATCH /api/user-settings` - Partial update user settings
- `GET /api/system-settings` - Get system settings
- `PUT /api/system-settings` - Replace system settings (Admin)
- `PATCH /api/system-settings` - Partial update system settings (Admin)

### Health
- `GET /api/health/live` - Liveness check
- `GET /api/health/ready` - Readiness check (includes DB)

## RBAC Model

### Roles
- **Admin**: Full access, manage users and system settings
- **Contributor**: Standard capabilities, manage own settings
- **Viewer**: Least privilege (default), manage own settings

### Key Permissions
- `system_settings:read/write` - System settings access
- `user_settings:read/write` - User settings access
- `users:read/write` - User management
- `rbac:manage` - Role assignment

## Database Tables

- `users` - User accounts with profile info
- `user_identities` - OAuth provider identities (provider + subject)
- `roles` / `permissions` / `role_permissions` - RBAC
- `user_roles` - User-to-role assignments
- `system_settings` - Global app settings (JSONB)
- `user_settings` - Per-user settings (JSONB)
- `audit_events` - Action audit log

## Security Guidelines

- Secrets via environment variables only (see `.env.example`)
- JWT access tokens are short-lived (10-20 min)
- Refresh tokens in HttpOnly cookies with rotation
- Input validation on all endpoints
- Rate limiting on auth and sensitive writes
- File uploads: images only, size/type limits, randomized filenames

## Testing Requirements

- Unit tests: isolated logic (services, guards, validators)
- Integration tests: API + DB + RBAC flows with test DB
- Mock OAuth in CI (no real Google dependency)
- Frontend: component and hook tests

## Environment Variables

Key variables (see `.env.example` for full list):
- `DATABASE_URL` - PostgreSQL connection string
- `JWT_SECRET` - JWT signing secret
- `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` - OAuth credentials
- `INITIAL_ADMIN_EMAIL` - First user with this email becomes Admin

## Common Patterns

### Adding a New API Endpoint
1. Create controller method with decorators for auth/RBAC
2. Add service method with business logic
3. Update OpenAPI annotations
4. Add unit + integration tests
5. Update API.md if needed

### Adding a New Setting
1. Update Zod schema for validation
2. Add migration if schema structure changes
3. Update TypeScript types
4. Add frontend UI if user-facing

## Specialized Subagents

This project includes specialized subagents in `.claude/agents/` for focused development tasks:

| Agent | Purpose | When to Use |
|-------|---------|-------------|
| `backend-dev` | NestJS API, auth, RBAC, services | Implementing API endpoints, guards, business logic |
| `frontend-dev` | React, MUI, components, theming | Building UI components, pages, responsive design |
| `database-dev` | PostgreSQL, Prisma, migrations | Schema changes, migrations, query optimization |
| `testing-dev` | Jest, Supertest, RTL, typecheck | Writing tests, ensuring type safety, CI quality |
| `docs-dev` | Technical documentation | Creating/updating architecture, security, API docs |

### Usage Examples
```
# Backend work
"Use backend-dev to implement the user settings endpoint"

# Frontend work
"Use frontend-dev to create the theme toggle component"

# Database work
"Use database-dev to add audit_events table migration"

# Testing work
"Use testing-dev to write integration tests for auth"

# Documentation work
"Use docs-dev to update SECURITY.md with new auth flow"
```