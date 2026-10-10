/**
 * `runStoragePurge`: what `npm run storage:purge`
 * (`appctl deploy uninstall --purge-storage`) runs INSIDE the api image (issue #404; packaged in #736).
 *
 * =============================================================================
 * ⚠ WHY THIS LIVES HERE AND NOT IN THE CLI
 * =============================================================================
 *
 * The portable deploy specification assumes the bucket and credential are in
 * the `.env`, and in this application they are not: since epic #372 the
 * provider, bucket, region and endpoint are the `storage` system-settings
 * namespace, and the secret access key is an encrypted row in `credentials`
 * under a per-purpose sub-key derived by `CredentialsService`.
 *
 * The obvious port — query PostgreSQL from the CLI and decrypt there — was
 * rejected for a concrete reason: `apps/cli/tsconfig.build.json` pins `rootDir`
 * to `./src`, so the CLI PROVABLY CANNOT import from `apps/api`. Doing the
 * crypto there would duplicate the sub-key label, the envelope layout AND the
 * prefix list into a package that cannot import the originals — two modules
 * required to agree with no mechanism to make them, which is the exact shape
 * behind almost every defect this epic has fixed.
 *
 * Run inside the image, it calls the application's own cipher, its own
 * `StorageConfigService` and its own `STORAGE_KEY_PREFIXES`, with the SDK
 * already present. WHAT A PURGE OF THE ACTIVE BACKEND MEANS IS THE ACTIVE
 * DRIVER'S: the S3 family's is version-aware (`drivers/s3/s3-purge.ts`), a
 * driver that only lists keys (`StorageDriver.listKeys`) is purged by deleting
 * each key through its provider, and a driver that offers neither is reported
 * as `unsupported`. Credentials arrive by name through compose's `env_file`;
 * the secret access key never leaves the container.
 *
 * =============================================================================
 * ⚠ TWO PHASES, BECAUSE CONSENT NEEDS SOMETHING TO BE ABOUT
 * =============================================================================
 *
 *   1. Default (`--json`): a DRY RUN. Counts objects and bytes under each
 *      prefix and prints them. Deletes nothing. The CLI renders this and asks
 *      the operator to type the bucket's name.
 *   2. `--confirm --bucket <typed>`: re-checks the typed name against the LIVE
 *      configuration *here*, inside the container, and refuses on a mismatch.
 *      The confirmation is verified where the truth is, not only where it was
 *      typed — a CLI that compared the name against its own copy would happily
 *      approve a purge of whatever the application had been repointed at since.
 *
 * =============================================================================
 * ⚠ VERSIONED BUCKETS, AND WHY UNKNOWN COUNTS AS VERSIONED
 * =============================================================================
 *
 * A versioned bucket keeps every object version and a delete marker for each
 * deletion, so `DeleteObject` on a listing leaves the data behind while
 * reporting success. Versions are therefore enumerated and removed by id.
 *
 * When the versioning status cannot be READ — no permission, an S3-compatible
 * endpoint that does not implement it — this treats the bucket as VERSIONED.
 * Assuming the cheaper answer is exactly what produces silent retention, and
 * silent retention is the one outcome a purge must never produce.
 */
import { Logger, type INestApplicationContext } from '@nestjs/common';

import type { ResolvedStorageConfig } from '../config/storage-config';
import { StorageConfigService } from '../config/storage-config.service';
import {
  requireStorageDriver,
  type StorageDriver,
  type StorageDriverContext,
  type StorageDriverPurgeResult,
} from '../drivers/storage-driver';
import { allKeyPrefixes } from '../storage-key-prefix.registry';
import { DEFAULT_STORAGE_PART_SIZE_BYTES } from '../storage.options';

export type { StoragePurgeClient } from '../drivers/s3/s3-purge';
import type { StoragePurgeClient } from '../drivers/s3/s3-purge';
// The built-in drivers register on import: whatever resolves a driver by id finds them.
import '../drivers/builtin-storage-drivers';

/**
 * What the purge found (and, when not a dry run, deleted) under one prefix.
 *
 * @stability experimental
 */
export interface StoragePurgePrefixReport {
  /** The registered root prefix. */
  prefix: string;
  /** Objects (or object versions) under it. */
  objects: number;
  /** Their bytes. */
  bytes: number;
}

/**
 * The JSON report `npm run storage:purge` prints and the CLI renders. Shape
 * unchanged since #404.
 *
 * @stability experimental
 */
export interface StoragePurgeReport {
  /** The live bucket (or container, or directory). */
  bucket: string;
  /** The live driver id. */
  provider: string;
  /** The live endpoint, or `null` for the SDK's own host. */
  endpoint: string | null;
  /** The bucket's versioning status; `unknown` is treated as versioned. */
  versioning: 'enabled' | 'suspended' | 'unversioned' | 'unknown';
  /** One entry per registered prefix, in registry order. */
  prefixes: StoragePurgePrefixReport[];
  /** Sums over {@link StoragePurgeReport.prefixes}. */
  totals: {
    /** Objects (or versions) under every prefix. */
    objects: number;
    /** Their bytes. */
    bytes: number;
  };
  /** Objects, versions and delete markers deleted (0 on a dry run). */
  deleted: number;
  /** Whether nothing was deleted. */
  dryRun: boolean;
}

/**
 * Options of {@link runStoragePurge}.
 *
 * @stability experimental
 */
export interface StoragePurgeOptions {
  /** `--confirm`: delete, after re-checking `bucket` against the LIVE configuration. Default: a dry run. */
  confirm?: boolean;
  /** `--bucket <typed>`: the bucket name the operator typed. */
  bucket?: string;
  /** Builds the active driver's own client from the live configuration; tests pass a fake. Default: the driver builds its own. */
  createClient?: (config: ResolvedStorageConfig) => StoragePurgeClient;
}

/**
 * The outcome of {@link runStoragePurge}.
 *
 * @stability experimental
 */
export type StoragePurgeOutcome =
  | {
      /** Storage was never configured: nothing to purge (not an error). */
      kind: 'not-configured';
    }
  | {
      /** `confirm` with a `bucket` that is not the live one: refused, nothing listed. */
      kind: 'refused';
      /** What was typed. */
      typed: string | undefined;
      /** The live bucket. */
      bucket: string;
    }
  | {
      /** The active driver can neither purge nor list its keys: nothing was done. */
      kind: 'unsupported';
      /** The live driver id. */
      provider: string;
    }
  | {
      /** The dry-run or deletion report. */
      kind: 'report';
      /** The report. */
      report: StoragePurgeReport;
    };

/**
 * Purges (or, by default, counts) every object under every registered key
 * prefix (`allKeyPrefixes()` of the booted app, platform and app prefixes
 * alike) in the deployment's LIVE bucket. Targets come ONLY from the
 * registry, never from a filtered listing of the whole bucket.
 *
 * @param app - the booted application context (`NestFactory.createApplicationContext(AppModule)`).
 * @param opts - see {@link StoragePurgeOptions}.
 * @returns what happened; see {@link StoragePurgeOutcome}.
 *
 * @example
 * ```ts
 * const outcome = await runStoragePurge(app, { confirm: false });
 * ```
 *
 * @extensionPoint hook
 * @stability experimental
 */
export async function runStoragePurge(
  app: Pick<INestApplicationContext, 'get'>,
  opts: StoragePurgeOptions = {},
): Promise<StoragePurgeOutcome> {
  const storage = app.get(StorageConfigService, { strict: false });
  const config = await storage.resolveActiveConfig({ fresh: true });

  if (config === null) return { kind: 'not-configured' };

  const confirm = opts.confirm === true;
  if (confirm && opts.bucket !== config.bucket) {
    // Verified HERE, against the live configuration, not against whatever the
    // CLI last read.
    return { kind: 'refused', typed: opts.bucket, bucket: config.bucket };
  }

  const driver = requireStorageDriver(config.provider);
  // The purge runs in a bare application context with no HTTP request: the
  // driver gets its settings, its secrets and the default part size.
  const ctx: StorageDriverContext = {
    settings: config.settings as Record<string, unknown>,
    secret: async (name) => config.secrets[name] ?? null,
    logger: new Logger('StoragePurge'),
    partSize: DEFAULT_STORAGE_PART_SIZE_BYTES,
  };
  const input = { prefixes: allKeyPrefixes(), dryRun: !confirm };

  let result: StorageDriverPurgeResult;

  if (driver.purge) {
    result = await driver.purge(ctx, { ...input, ...(opts.createClient ? { client: opts.createClient(config) } : {}) });
  } else if (driver.listKeys) {
    result = await purgeByListing(driver, ctx, input);
  } else {
    return { kind: 'unsupported', provider: config.provider };
  }

  return {
    kind: 'report',
    report: {
      bucket: config.bucket,
      provider: config.provider,
      endpoint: config.endpoint ?? null,
      versioning: result.versioning,
      prefixes: result.prefixes,
      totals: {
        objects: result.prefixes.reduce((sum, entry) => sum + entry.objects, 0),
        bytes: result.prefixes.reduce((sum, entry) => sum + entry.bytes, 0),
      },
      deleted: result.deleted,
      dryRun: input.dryRun,
    },
  };
}

/**
 * The generic purge: list every key under each prefix with the driver's
 * `listKeys`, and (unless a dry run) delete each through the provider the
 * driver builds. Sizes are not known without a `HEAD` per key, so `bytes` is 0.
 */
async function purgeByListing(
  driver: StorageDriver,
  ctx: StorageDriverContext,
  input: { prefixes: readonly string[]; dryRun: boolean },
): Promise<StorageDriverPurgeResult> {
  const provider = input.dryRun ? undefined : await driver.build(ctx);
  const prefixes: StoragePurgePrefixReport[] = [];
  let deleted = 0;

  try {
    for (const prefix of input.prefixes) {
      const report: StoragePurgePrefixReport = { prefix, objects: 0, bytes: 0 };

      for await (const key of (driver.listKeys as NonNullable<StorageDriver['listKeys']>)(ctx, prefix)) {
        report.objects += 1;
        if (provider) {
          await provider.delete(key);
          deleted += 1;
        }
      }

      prefixes.push(report);
    }
  } finally {
    (provider as { destroy?: () => void } | undefined)?.destroy?.();
  }

  return { versioning: 'unversioned', prefixes, deleted };
}

/**
 * The `npm run storage:purge` command line over {@link runStoragePurge}:
 * `--confirm` and `--bucket <typed>` parsed from `argv`, the JSON written to
 * `stdout`, a refusal to `stderr`. Output and exit codes unchanged since #404.
 *
 * @param app - the booted application context.
 * @param argv - the process arguments (`process.argv`).
 * @param io - where to write; defaults to the process streams.
 * @returns the exit code: 0, 2 for a refused confirmation, or 3 when the active driver can neither purge nor list its keys.
 *
 * @stability experimental
 */
export async function runStoragePurgeCli(
  app: Pick<INestApplicationContext, 'get'>,
  argv: readonly string[],
  io: { stdout: (text: string) => void; stderr: (text: string) => void } = {
    stdout: (text) => void process.stdout.write(text),
    stderr: (text) => void process.stderr.write(text),
  },
  createClient?: StoragePurgeOptions['createClient'],
): Promise<number> {
  const flag = (name: string) => argv.includes(`--${name}`);
  const value = (name: string) => {
    const index = argv.indexOf(`--${name}`);
    return index === -1 ? undefined : argv[index + 1];
  };

  const outcome = await runStoragePurge(app, {
    confirm: flag('confirm'),
    bucket: value('bucket'),
    ...(createClient ? { createClient } : {}),
  });

  if (outcome.kind === 'not-configured') {
    // Not an error: a deployment that never configured storage has nothing
    // to purge, and saying so is more useful than failing.
    io.stdout(`${JSON.stringify({ configured: false, reason: 'object storage is not configured for this deployment' })}\n`);
    return 0;
  }
  if (outcome.kind === 'refused') {
    io.stderr(`Refusing: --bucket was ${String(outcome.typed)} but this deployment's bucket is ${outcome.bucket}.\n`);
    return 2;
  }
  if (outcome.kind === 'unsupported') {
    io.stderr(`The ${outcome.provider} storage driver can neither purge nor list its keys; nothing was done.\n`);
    return 3;
  }
  io.stdout(`${JSON.stringify(outcome.report, null, 2)}\n`);
  return 0;
}
