// seedPlatform (issue #712): the platform's idempotent seed, extracted from
// the reference app's prisma/seed.ts with the same writes, in the same order,
// under the same console lines.

import { assertSeedSteps, runSeedStep, type SeedPlatformOptions, type SeedStep, type SeedStepSummary, type SeedTransactionHost } from './steps.js';
import type { PlatformSeedInput, SeedJsonValue, SeedLogger, SeedNamedEntry, SeedPrisma, SeedScope, SeedSummary } from './types.js';

/** The `global` row's key: the one `system_settings` row the platform owns. */
const GLOBAL_SETTINGS_KEY = 'global';

/** The default organization when the input names none. Mirrors the migration's backfill row. */
const DEFAULT_ORGANIZATION = { name: 'Default organization', slug: 'default' } as const;

/** The note on the initial administrator's allowlist row. */
const INITIAL_ADMIN_NOTE = 'Initial admin (auto-seeded)';

const SILENT: SeedLogger = { info: () => undefined };

/** `{ scope }` when the entry declares one, `{}` otherwise (a catalog from before scopes). */
function scopeOf(entry: SeedNamedEntry): { scope?: SeedScope } {
  return entry.scope ? { scope: entry.scope } : {};
}

/**
 * Seed the platform's roles and permissions (each with its `system` or `org`
 * scope, refreshed on every run like the description), default grants, the `global` system
 * settings row, the initial administrator's allowlist entry and the default
 * organization.
 *
 * Idempotent: every write is an upsert keyed on a natural unique (`name`,
 * `roleId_permissionId`, `key`, `email`), so a second run updates the same
 * rows. It **never deletes**: a permission that left the registry stays as a
 * row until an explicit migration removes it (expand/contract). It never
 * overwrites an admin-edited value either: the settings row and the allowlist
 * row are created with `update: {}`. Writes are sequential, in a fixed order
 * (roles, permissions, grants, settings, allowlist, default organization), so
 * the log reads the same on every run. The default organization is created only
 * when no organization is flagged default (found by `isDefault`, not by slug),
 * so a renamed default is left alone and the one-default index is never hit.
 *
 * App steps (`extras`, see {@link SeedStep}) run after the default organization,
 * in array order, each in its own transaction when the client has
 * `$transaction`, under the same logger: `Seeding <id>...` then
 * `✓ <id>: <created> created, <updated> updated`. They are validated before
 * anything is written, and each must be idempotent ({@link assertSeedIdempotent}
 * proves it).
 *
 * @param prisma - The app's Prisma client, or any object with the delegates of {@link SeedPrisma}.
 * @param input - What to write; see {@link PlatformSeedInput}.
 * @param options - Receives one line per step; default: silent. A bare {@link SeedLogger} (the previous third argument) is still accepted. Or {@link SeedPlatformOptions}: `{ log, extras }`.
 * @returns What the run did.
 * @throws SeedStepError for an invalid extra step, before any write; SeedStepError wrapping what a step threw; whatever the client throws otherwise. Nothing else is caught, so a failed seed fails loudly.
 *
 * @example
 * ```ts
 * await seedPlatform(prisma, input, { log: { info: console.log }, extras: [seedCoachDefaults] });
 * ```
 *
 * @stability experimental
 */
export async function seedPlatform<Tx = SeedPrisma>(
  prisma: SeedPrisma,
  input: PlatformSeedInput,
  options: SeedLogger | SeedPlatformOptions<Tx> = SILENT,
): Promise<SeedSummary> {
  const given = options as Partial<SeedLogger> & SeedPlatformOptions<Tx>;
  const log: SeedLogger = typeof given.info === 'function' ? (given as SeedLogger) : (given.log ?? SILENT);
  const extras: ReadonlyArray<SeedStep<never>> = (typeof given.info === 'function' ? undefined : given.extras) as ReadonlyArray<SeedStep<never>> ?? [];
  assertSeedSteps(extras);

  log.info('Seeding roles...');
  for (const role of input.roles) {
    await prisma.role.upsert({
      where: { name: role.name },
      update: { description: role.description, ...scopeOf(role) },
      create: { name: role.name, description: role.description, ...scopeOf(role) },
    });
  }
  log.info(`✓ Seeded ${input.roles.length} roles`);

  log.info('Seeding permissions...');
  for (const permission of input.permissions) {
    await prisma.permission.upsert({
      where: { name: permission.name },
      update: { description: permission.description, ...scopeOf(permission) },
      create: { name: permission.name, description: permission.description, ...scopeOf(permission) },
    });
  }
  log.info(`✓ Seeded ${input.permissions.length} permissions`);

  log.info('Seeding role-permission mappings...');
  let rolePermissions = 0;
  const skippedGrants: string[] = [];
  for (const [roleName, permissionNames] of Object.entries(input.roleGrants)) {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role) {
      skippedGrants.push(roleName);
      continue;
    }
    for (const permissionName of permissionNames) {
      const permission = await prisma.permission.findUnique({ where: { name: permissionName } });
      if (!permission) {
        skippedGrants.push(`${roleName}: ${permissionName}`);
        continue;
      }
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        update: {},
        create: { roleId: role.id, permissionId: permission.id },
      });
      rolePermissions++;
    }
  }
  log.info(`✓ Seeded ${rolePermissions} role-permission mappings`);
  for (const skipped of skippedGrants) log.info(`⊘ Skipped grant with no matching row: ${skipped}`);

  log.info('Seeding system settings...');
  await prisma.systemSettings.upsert({
    where: { key: GLOBAL_SETTINGS_KEY },
    update: {}, // Don't overwrite existing settings
    create: { key: GLOBAL_SETTINGS_KEY, value: input.systemSettingsDefaults as { [key: string]: SeedJsonValue }, version: 1 },
  });
  log.info('✓ Seeded default system settings');

  log.info('Seeding initial admin allowlist...');
  let allowlistedEmail: string | null = null;
  if (input.initialAdminEmail) {
    allowlistedEmail = input.initialAdminEmail.toLowerCase();
    await prisma.allowedEmail.upsert({
      where: { email: allowlistedEmail },
      update: {},
      create: { email: allowlistedEmail, notes: INITIAL_ADMIN_NOTE },
    });
    log.info(`✓ Added ${input.initialAdminEmail} to allowlist`);
  } else {
    log.info('⊘ INITIAL_ADMIN_EMAIL not set, skipping allowlist seed');
  }

  log.info('Seeding default organization...');
  const defaultOrganization = input.defaultOrganization ?? DEFAULT_ORGANIZATION;
  // `select: { id }`: the seed reads and returns only the key, so it also runs against a database
  // that is migrated only part of the way (a column added by a later migration is not read).
  const existingDefault = await prisma.organization.findFirst({ where: { isDefault: true }, select: { id: true } });
  const defaultOrganizationCreated = existingDefault === null;
  if (defaultOrganizationCreated) {
    await prisma.organization.upsert({
      where: { slug: defaultOrganization.slug },
      update: {}, // Don't overwrite an administrator's edits
      create: { name: defaultOrganization.name, slug: defaultOrganization.slug, isDefault: true },
      select: { id: true },
    });
    log.info(`✓ Created default organization "${defaultOrganization.slug}"`);
  } else {
    log.info('✓ Default organization already exists');
  }

  const summary: SeedSummary = {
    roles: input.roles.length,
    permissions: input.permissions.length,
    rolePermissions,
    skippedGrants,
    allowlistedEmail,
    defaultOrganizationCreated,
  };

  if (extras.length > 0) {
    const ran: SeedStepSummary[] = [];
    const ctx = { log, input, platform: summary };
    for (const step of extras) {
      log.info(`Seeding ${step.id}...`);
      const result = await runSeedStep(prisma as SeedPrisma & SeedTransactionHost, step, ctx);
      log.info(`✓ ${step.id}: ${result.created} created, ${result.updated} updated`);
      ran.push({ id: step.id, ...result });
    }
    summary.extras = ran;
  }
  return summary;
}
