# Database Environment Variables Migration

## Overview

The application has been updated to support constructing `DATABASE_URL` from individual PostgreSQL environment variables instead of requiring a single monolithic connection string.

## What Changed

### New Environment Variables

Instead of a single `DATABASE_URL`, the application now uses:

| Variable | Description | Default |
|----------|-------------|---------|
| `POSTGRES_HOST` | PostgreSQL server hostname | `localhost` (or `db` in Docker) |
| `POSTGRES_PORT` | PostgreSQL server port | `5432` |
| `POSTGRES_USER` | Database user | `postgres` |
| `POSTGRES_PASSWORD` | Database password | `postgres` |
| `POSTGRES_DB` | Database name | `appdb` |
| `POSTGRES_SSL` | Enable SSL (`true`/`false`) | `false` |

### Why This Change?

**Benefits:**
1. **Flexibility**: Easier to configure across different environments (Docker, local, CI/CD)
2. **Security**: Passwords can be injected via secrets managers without constructing URLs
3. **Clarity**: Each component is explicit and easy to understand
4. **Docker-friendly**: Aligns with standard PostgreSQL container environment variables
5. **Testability**: Easy to override individual components in tests

### Files Modified

#### 1. `apps/api/scripts/prisma-env.js` (NEW)
A helper script that constructs `DATABASE_URL` from individual variables before running Prisma CLI commands.

**Purpose:** Bridge the gap between our flexible variable structure and Prisma's requirement for `DATABASE_URL`.

#### 2. `apps/api/package.json`
Added npm scripts that use the helper:

```json
{
  "scripts": {
    "prisma": "node scripts/prisma-env.js",
    "prisma:generate": "node scripts/prisma-env.js generate",
    "prisma:migrate": "node scripts/prisma-env.js migrate deploy",
    "prisma:migrate:dev": "node scripts/prisma-env.js migrate dev",
    "prisma:studio": "node scripts/prisma-env.js studio",
    "prisma:seed": "node scripts/prisma-env.js db seed"
  }
}
```

#### 3. `infra/compose/base.compose.yml`
Updated API service environment to pass individual variables instead of `DATABASE_URL`:

```yaml
environment:
  - POSTGRES_HOST=${POSTGRES_HOST:-db}
  - POSTGRES_PORT=${POSTGRES_PORT:-5432}
  - POSTGRES_USER=${POSTGRES_USER:-postgres}
  - POSTGRES_PASSWORD=${POSTGRES_PASSWORD:-postgres}
  - POSTGRES_DB=${POSTGRES_DB:-appdb}
  - POSTGRES_SSL=${POSTGRES_SSL:-false}
```

#### 4. `infra/compose/.env.example`
Updated to document the new individual variables (already present).

#### 5. `apps/api/Dockerfile`
- Added `scripts/` folder to dependency and production stages
- Set dummy `DATABASE_URL` for build-time `prisma generate` (connection not needed at build time)

#### 6. `apps/api/.env.test`
Added individual variables while keeping backward-compatible `DATABASE_URL`:

```bash
POSTGRES_HOST=localhost
POSTGRES_PORT=5433
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=enterprise_app_test
POSTGRES_SSL=false

# Legacy (kept for direct Prisma CLI usage)
DATABASE_URL=postgresql://postgres:postgres@localhost:5433/enterprise_app_test
```

#### 7. Documentation Updates
- `apps/api/scripts/README.md` (NEW) - Comprehensive documentation of the helper script
- `docs/DEVELOPMENT.md` - Updated migration commands to use npm scripts
- `CLAUDE.md` - Updated Prisma commands
- `.claude/agents/database-dev.md` - Updated agent instructions

### Files NOT Changed

#### `apps/api/prisma/schema.prisma`
**No changes needed.** The schema still uses:

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

Prisma always requires `DATABASE_URL` as an environment variable - we just construct it differently now.

#### `apps/api/src/config/configuration.ts`
**Already implemented!** This file already constructs `DATABASE_URL` from individual variables at runtime:

```typescript
const databaseUrl = `postgresql://${user}:${password}@${host}:${port}/${dbName}${sslParam}`;
process.env.DATABASE_URL = databaseUrl;
```

## Migration Guide

### For Existing Deployments

If you have existing `.env` files using `DATABASE_URL`:

**Option 1: Migrate to individual variables (recommended)**

Old `.env`:
```bash
DATABASE_URL=postgresql://myuser:mypass@db.example.com:5432/mydb?sslmode=require
```

New `.env`:
```bash
POSTGRES_HOST=db.example.com
POSTGRES_PORT=5432
POSTGRES_USER=myuser
POSTGRES_PASSWORD=mypass
POSTGRES_DB=mydb
POSTGRES_SSL=true
```

**Option 2: Keep both (temporary)**

You can keep `DATABASE_URL` temporarily, but it will be ignored by the application at runtime (it constructs its own from individual variables).

### For New Deployments

Use the template from `infra/compose/.env.example` and fill in individual variables.

### For CI/CD Pipelines

Update your pipeline configuration to set individual variables:

**GitHub Actions example:**
```yaml
env:
  POSTGRES_HOST: ${{ secrets.DB_HOST }}
  POSTGRES_PORT: 5432
  POSTGRES_USER: ${{ secrets.DB_USER }}
  POSTGRES_PASSWORD: ${{ secrets.DB_PASSWORD }}
  POSTGRES_DB: production_db
  POSTGRES_SSL: true
```

**GitLab CI example:**
```yaml
variables:
  POSTGRES_HOST: db.example.com
  POSTGRES_PORT: "5432"
  POSTGRES_USER: $DB_USER
  POSTGRES_PASSWORD: $DB_PASSWORD
  POSTGRES_DB: production_db
  POSTGRES_SSL: "true"
```

## Usage Examples

### Local Development

**Before (old method):**
```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/appdb"
npx prisma migrate dev
```

**After (new method):**
```bash
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_USER=user
export POSTGRES_PASSWORD=pass
export POSTGRES_DB=appdb
export POSTGRES_SSL=false

npm run prisma:migrate:dev
```

### Docker Container

Environment variables are automatically available in Docker:

```bash
# Exec into container
docker compose exec api sh

# Run migrations (variables already set by Docker Compose)
npm run prisma:migrate

# Generate Prisma client
npm run prisma:generate
```

### Kubernetes

Use ConfigMaps and Secrets:

```yaml
apiVersion: v1
kind: Secret
metadata:
  name: db-credentials
stringData:
  POSTGRES_PASSWORD: supersecretpassword

---
apiVersion: v1
kind: ConfigMap
metadata:
  name: db-config
data:
  POSTGRES_HOST: postgres.default.svc.cluster.local
  POSTGRES_PORT: "5432"
  POSTGRES_USER: appuser
  POSTGRES_DB: appdb
  POSTGRES_SSL: "true"

---
apiVersion: apps/v1
kind: Deployment
spec:
  template:
    spec:
      containers:
      - name: api
        envFrom:
        - configMapRef:
            name: db-config
        - secretRef:
            name: db-credentials
```

## Troubleshooting

### Error: "Can't reach database"

**Check environment variables are set:**
```bash
echo $POSTGRES_HOST
echo $POSTGRES_PORT
echo $POSTGRES_USER
echo $POSTGRES_DB
```

**Test database connectivity:**
```bash
psql -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB
```

### Error: "No Prisma command specified"

You're calling the helper script without a Prisma command.

**Wrong:** `npm run prisma`
**Correct:** `npm run prisma:generate` or `npm run prisma -- migrate deploy`

### Error: "Authentication failed"

Check `POSTGRES_PASSWORD` is correct. Special characters in passwords are automatically URL-encoded by the helper script.

### Prisma generates but app can't connect

Two different issues:

1. **Build time**: Prisma CLI needs `DATABASE_URL` → handled by `scripts/prisma-env.js`
2. **Runtime**: Application needs database → handled by `src/config/configuration.ts`

Both are now properly configured.

## Backward Compatibility

### Runtime Application
The application **always** constructs `DATABASE_URL` from individual variables at runtime. Even if you set `DATABASE_URL` manually, it will be overwritten by `configuration.ts`.

### Prisma CLI
Use the provided npm scripts (`prisma:*`). They handle the variable construction automatically.

### Tests
Test files (`.env.test`) can provide both formats:
- Individual variables for the application
- `DATABASE_URL` for direct Prisma CLI usage (if not using npm scripts)

## Best Practices

1. **Use npm scripts**: Always prefer `npm run prisma:*` over direct `npx prisma` commands
2. **Never commit credentials**: Use `.env` files (gitignored) or secrets managers
3. **Separate databases per environment**: test, development, staging, production
4. **Use SSL in production**: Set `POSTGRES_SSL=true`
5. **Strong passwords**: Use password managers or secrets generators
6. **Audit access**: Review who has database credentials

## References

- `apps/api/scripts/README.md` - Detailed documentation of the helper script
- `apps/api/src/config/configuration.ts` - Runtime configuration
- `infra/compose/.env.example` - Environment variables template
- `docs/DEVELOPMENT.md` - Development workflow guide

## Questions?

If you encounter issues after this migration:

1. Check environment variables are set correctly
2. Review `apps/api/scripts/README.md` for troubleshooting
3. Verify database is accessible: `docker compose ps db`
4. Check container logs: `docker compose logs api -f`
5. Test direct database connection with `psql`

## Summary

**What you need to know:**

1. Set individual `POSTGRES_*` variables instead of `DATABASE_URL`
2. Use npm scripts for Prisma commands: `npm run prisma:generate`, `npm run prisma:migrate`, etc.
3. Everything else works the same - no changes to Prisma schema or application logic
4. The migration is backward compatible - update at your own pace

**What changed under the hood:**

1. Added `scripts/prisma-env.js` to construct `DATABASE_URL` for Prisma CLI
2. Updated Docker Compose to pass individual variables
3. Updated npm scripts to use the helper
4. Documentation updated to reflect new approach

**What stayed the same:**

1. Prisma schema still uses `env("DATABASE_URL")`
2. Application runtime configuration already handled this
3. Database structure, migrations, and queries unchanged
