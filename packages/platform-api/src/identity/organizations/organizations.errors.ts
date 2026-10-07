import { DatabaseSeedException } from '@marinoscar/platform-api/core';

/**
 * Raised when the default organization does not exist: the migration's
 * backfill and the seed (`ensureDefaultOrg`) both create it, so a missing row
 * means neither ran. A `DatabaseSeedException`, so it reaches the client as the
 * same 500 with the seed instructions every other missing seed row produces.
 */
export class DefaultOrganizationMissingException extends DatabaseSeedException {
  constructor() {
    super('Default organization (slug "default")', 'npm run prisma:seed');
  }
}
