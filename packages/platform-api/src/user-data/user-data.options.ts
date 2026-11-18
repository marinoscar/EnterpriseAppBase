// The user-data slice's module options (issue #743, PP-9.1).

import type { ModuleMetadata, Type } from '@nestjs/common';

import { DefaultUserDataEnvironment } from './default-environment';
import type { UserDataEnvironment } from './ports';
import type { PurgeDatamodel } from './purge/purge-planner';
import type { LegacyUserDataJobType, UserRemovalHook } from './user-data.types';

/**
 * A model column naming a job: the factory reset keeps the jobs such rows link to.
 *
 * @stability experimental
 */
export interface JobReference {
  /** The Prisma model (`DatabaseBackupRun`). */
  readonly model: string;
  /** Its column holding a job id (`jobId`). */
  readonly field: string;
}

/**
 * Injection token of the resolved options.
 *
 * @stability experimental
 */
export const USER_DATA_OPTIONS: unique symbol = Symbol.for('@marinoscar/platform/user-data/OPTIONS');

/**
 * What an app passes to `UserDataModule.forRoot()`.
 *
 * @stability experimental
 * @extensionPoint option
 * @example
 * ```ts
 * UserDataModule.forRoot({
 *   imports: [UserDataHostModule],
 *   datamodel: () => readSchemaDatamodel(join(__dirname, '../../../prisma/schema')),
 *   userRemovalHooks: [groupMembershipRemovalHook],
 *   factoryReset: { keepJobsReferencedBy: [{ model: 'DatabaseBackupRun', field: 'jobId' }] },
 * });
 * ```
 */
export interface UserDataModuleOptions {
  /**
   * The parsed Prisma schema the purge planner orders deletes from (the
   * generated client's DMMF lacks `onDelete`). A function is called once, at
   * bootstrap.
   */
  datamodel: PurgeDatamodel | (() => PurgeDatamodel);
  /** Modules binding `USER_DATA_DB`, the bypass client (the one port an app must supply). */
  imports?: ModuleMetadata['imports'];
  /**
   * The deployment and tenancy modes the slice gates on. Default
   * {@link DefaultUserDataEnvironment}: the host slice's `DeploymentModeService`
   * and identity's `TenancyService`.
   */
  environment?: Type<UserDataEnvironment>;
  /**
   * Job types an app queued before adopting the platform. Each gets an alias
   * handler that maps the old payload and runs `user.data.purge`'s work.
   * Default none.
   */
  legacyJobTypes?: readonly LegacyUserDataJobType[];
  /** Work run before a user ROW is deleted (the sharing slice's last-admin rule). Default none. */
  userRemovalHooks?: readonly UserRemovalHook[];
  /** Factory reset options. */
  factoryReset?: {
    /**
     * Jobs a row of these models links to survive step 1 (the backups'
     * jobs: `{ model: 'DatabaseBackupRun', field: 'jobId' }`). Default none.
     */
    keepJobsReferencedBy?: readonly JobReference[];
  };
  /** The row transaction's timeout, in milliseconds. Default 5 minutes. */
  txTimeoutMs?: number;
}

/**
 * The options after defaults.
 *
 * @stability experimental
 */
export interface ResolvedUserDataModuleOptions {
  /** See {@link UserDataModuleOptions.datamodel}. */
  readonly datamodel: () => PurgeDatamodel;
  /** See {@link UserDataModuleOptions.imports}. */
  readonly imports: NonNullable<ModuleMetadata['imports']>;
  /** See {@link UserDataModuleOptions.environment}. */
  readonly environment: Type<UserDataEnvironment>;
  /** See {@link UserDataModuleOptions.legacyJobTypes}. */
  readonly legacyJobTypes: readonly LegacyUserDataJobType[];
  /** See {@link UserDataModuleOptions.userRemovalHooks}. */
  readonly userRemovalHooks: readonly UserRemovalHook[];
  /** See {@link UserDataModuleOptions.factoryReset}. */
  readonly keepJobsReferencedBy: readonly JobReference[];
  /** See {@link UserDataModuleOptions.txTimeoutMs}. */
  readonly txTimeoutMs: number;
}

/**
 * The default row transaction timeout: 5 minutes (EvoPath's).
 *
 * @stability experimental
 */
export const USER_DATA_TX_TIMEOUT_MS = 5 * 60_000;

function fail(why: string): never {
  throw new Error(`UserDataModule.forRoot: ${why}.`);
}

/**
 * Validates and defaults the options.
 *
 * @param options - the module options.
 * @returns the resolved options.
 * @throws Error naming the bad option.
 *
 * @stability experimental
 */
export function resolveUserDataModuleOptions(options: UserDataModuleOptions): ResolvedUserDataModuleOptions {
  if (!options || (typeof options.datamodel !== 'function' && !Array.isArray(options.datamodel))) {
    fail('`datamodel` is required: the parsed schema (readSchemaDatamodel) or a function returning it');
  }
  const datamodel = options.datamodel;
  let cached: PurgeDatamodel | undefined;
  const legacy = options.legacyJobTypes ?? [];
  const seen = new Set<string>();
  for (const alias of legacy) {
    if (typeof alias?.type !== 'string' || alias.type.trim() === '') fail('every `legacyJobTypes[]` needs a `type`');
    if (typeof alias.toPayload !== 'function') fail(`legacy job type "${alias.type}" needs a \`toPayload\` function`);
    if (seen.has(alias.type)) fail(`legacy job type "${alias.type}" is listed twice`);
    seen.add(alias.type);
  }
  for (const hook of options.userRemovalHooks ?? []) {
    if (typeof hook?.id !== 'string' || typeof hook.run !== 'function' || hook.inject === undefined) {
      fail('every `userRemovalHooks[]` needs an `id`, an `inject` token and a `run` function');
    }
  }
  const timeout = options.txTimeoutMs ?? USER_DATA_TX_TIMEOUT_MS;
  if (!Number.isSafeInteger(timeout) || timeout < 1000) fail('`txTimeoutMs` must be an integer of at least 1000');
  return {
    datamodel: () => (cached ??= typeof datamodel === 'function' ? datamodel() : datamodel),
    imports: options.imports ?? [],
    environment: options.environment ?? DefaultUserDataEnvironment,
    legacyJobTypes: legacy,
    userRemovalHooks: options.userRemovalHooks ?? [],
    keepJobsReferencedBy: options.factoryReset?.keepJobsReferencedBy ?? [],
    txTimeoutMs: timeout,
  };
}
