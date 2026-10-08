import { buildDatabaseUrl } from '@marinoscar/platform-api/core';
import { identityConfiguration } from '@marinoscar/platform-api/identity';
import { jobsConfiguration } from '@marinoscar/platform-api/jobs';

/**
 * The app's configuration tree (`ConfigService`). The platform slices read
 * their own keys from it, so each slice's `*Configuration(env)` is spread in
 * as it is; only `nodeEnv`, `port`, `appUrl` and `database` are the app's.
 * Every variable is documented in `infra/compose/.env.example`.
 */
export default () => {
  const databaseUrl = buildDatabaseUrl(process.env);
  // Prisma's driver adapter and the CLI read the same URL.
  process.env.DATABASE_URL = databaseUrl;

  return {
    nodeEnv: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT || '3000', 10),
    appUrl: process.env.APP_URL || 'http://localhost:3535',
    database: { url: databaseUrl },
    ...identityConfiguration(process.env),
    ...jobsConfiguration(process.env),
  };
};
