# API Scripts

This folder contains utility scripts for database and development operations.

## Scripts at a glance

| Script | npm script | What it does |
|---|---|---|
| `prisma-env.js` | `prisma:*` | Builds `DATABASE_URL` from `POSTGRES_*` and runs the Prisma CLI (below) |
| `dump-openapi.ts` | `openapi:dump` | Writes the OpenAPI document without a database |
| `generate-permission-catalog.ts` | `catalog:permissions` | Writes the role and permission registries to `prisma/catalog/permissions.json`, which the seed reads; `-- --check` exits 1 when the committed file is stale. See [common/permissions/README.md](../src/common/permissions/README.md) |
| `generate-settings-catalog.ts` | `catalog:settings` | Writes the system settings namespace defaults to `prisma/catalog/system-settings-defaults.json`, which the seed reads; `-- --check` exits 1 when the committed file is stale (below) |

## generate-settings-catalog.ts

Renders `prisma/catalog/system-settings-defaults.json`, the system settings
defaults `prisma/seed-data.ts` seeds, from the settings namespace registry
(`src/settings/registry/`). The seed cannot import `src/` (it runs under
ts-node outside the Nest build, and the production image carries `prisma/` but
not `src/`), so it reads this committed, generated copy instead.

```bash
npm run catalog:settings --workspace=api             # regenerate after changing a namespace or a default
npm run catalog:settings --workspace=api -- --check  # exit 1, printing the fix, when the file is stale
```

`test/settings/settings-catalog.spec.ts` runs the same staleness check in
`npm test`. See [src/settings/registry/README.md](../src/settings/registry/README.md).

## prisma-env.js

A helper script that constructs `DATABASE_URL` from individual PostgreSQL environment variables before executing Prisma CLI commands.

### Why This Script Exists

The application uses individual database connection variables (`POSTGRES_HOST`, `POSTGRES_PORT`, etc.) for flexibility across different environments (Docker, local development, CI/CD). However, Prisma CLI requires `DATABASE_URL` to be set as an environment variable.

This script bridges that gap by:
1. Reading individual PostgreSQL environment variables
2. Constructing a proper `DATABASE_URL` connection string
3. Executing Prisma CLI commands with the constructed URL

### Environment Variables

The script reads the following environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `POSTGRES_HOST` | `localhost` | PostgreSQL server hostname |
| `POSTGRES_PORT` | `5432` | PostgreSQL server port |
| `POSTGRES_USER` | `postgres` | Database user |
| `POSTGRES_PASSWORD` | `postgres` | Database password |
| `POSTGRES_DB` | `appdb` | Database name |
| `POSTGRES_SSL` | `false` | Enable SSL connection (`true`/`false`) |

### Usage

#### Via npm Scripts (Recommended)

```bash
# Generate Prisma client
npm run prisma:generate

# Run migrations (production)
npm run prisma:migrate

# Create migration (development)
npm run prisma:migrate:dev -- --name my_migration

# Open Prisma Studio
npm run prisma:studio

# Run database seed
npm run prisma:seed

# Any other Prisma command
npm run prisma -- [command] [args]
```

#### Direct Usage

```bash
# General syntax
node scripts/prisma-env.js [prisma command and args]

# Examples
node scripts/prisma-env.js migrate deploy
node scripts/prisma-env.js generate
node scripts/prisma-env.js db push
node scripts/prisma-env.js studio
```

### Examples

#### Local Development

```bash
# Set environment variables
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_USER=myuser
export POSTGRES_PASSWORD=mypassword
export POSTGRES_DB=mydb
export POSTGRES_SSL=false

# Run migrations
npm run prisma:migrate

# Generate Prisma client
npm run prisma:generate
```

#### Docker Container

Inside a Docker container, the environment variables are already set by Docker Compose:

```bash
# Exec into the API container
docker compose exec api sh

# Variables are already available, just run commands
npm run prisma:generate
npm run prisma:migrate
```

#### CI/CD Pipeline

```yaml
# GitHub Actions example
- name: Run database migrations
  env:
    POSTGRES_HOST: db.example.com
    POSTGRES_PORT: 5432
    POSTGRES_USER: ${{ secrets.DB_USER }}
    POSTGRES_PASSWORD: ${{ secrets.DB_PASSWORD }}
    POSTGRES_DB: production_db
    POSTGRES_SSL: true
  run: |
    cd apps/api
    npm run prisma:migrate
```

### How It Works

1. **Loads environment variables**: Uses `dotenv` if available (development) or relies on system environment (production/Docker)
2. **Constructs DATABASE_URL**: Builds a PostgreSQL connection string like:
   ```
   postgresql://user:password@host:port/database?sslmode=require
   ```
3. **Handles special characters**: URL-encodes passwords with special characters
4. **Executes Prisma CLI**: Spawns `npx prisma [command]` with the constructed `DATABASE_URL`
5. **Preserves exit codes**: Returns the same exit code as the Prisma CLI command

### Features

- **Cross-platform**: Works on Windows, macOS, and Linux
- **Flexible**: Supports all Prisma CLI commands and arguments
- **Secure**: URL-encodes passwords to handle special characters
- **SSL support**: Conditionally adds `?sslmode=require` based on `POSTGRES_SSL`
- **Fallback defaults**: Provides sensible defaults for all variables

### Migration from DATABASE_URL

If you previously used `DATABASE_URL` directly:

**Old approach:**
```bash
export DATABASE_URL="postgresql://user:pass@localhost:5432/db"
npx prisma migrate deploy
```

**New approach:**
```bash
export POSTGRES_HOST=localhost
export POSTGRES_PORT=5432
export POSTGRES_USER=user
export POSTGRES_PASSWORD=pass
export POSTGRES_DB=db
export POSTGRES_SSL=false

npm run prisma:migrate
```

### Troubleshooting

**Error: "No Prisma command specified"**
- You forgot to pass a Prisma command
- Solution: `npm run prisma -- [command]`

**Error: "Connection timeout" or "Can't reach database"**
- Check that environment variables are set correctly
- Verify database is running and accessible
- Test connection: `psql -h $POSTGRES_HOST -p $POSTGRES_PORT -U $POSTGRES_USER -d $POSTGRES_DB`

**Error: "Authentication failed"**
- Check `POSTGRES_USER` and `POSTGRES_PASSWORD` are correct
- If password has special characters, make sure they're properly set (the script handles URL encoding)

**Prisma generates but migrations fail**
- Ensure all environment variables are available
- Check network connectivity to database
- Verify database user has proper permissions

### Best Practices

1. **Use npm scripts**: Prefer `npm run prisma:migrate` over direct script execution
2. **Never hardcode credentials**: Always use environment variables
3. **Use different databases per environment**: test, development, staging, production
4. **Keep `.env` files out of version control**: Add to `.gitignore`
5. **Use secrets management in production**: Store credentials securely (e.g., AWS Secrets Manager, HashiCorp Vault)

### Related Files

- `package.json` - Defines npm scripts using this helper
- `prisma/schema.prisma` - Prisma schema (uses `env("DATABASE_URL")`)
- `src/config/configuration.ts` - Runtime configuration (constructs DATABASE_URL for the app)
- `infra/compose/.env.example` - Environment variables template
- `infra/compose/base.compose.yml` - Docker Compose configuration
