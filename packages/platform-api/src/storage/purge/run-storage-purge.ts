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
 * already present. Credentials arrive by name through compose's `env_file`;
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
import {
  DeleteObjectsCommand,
  GetBucketVersioningCommand,
  ListObjectVersionsCommand,
  ListObjectsV2Command,
  S3Client,
  type GetBucketVersioningCommandOutput,
  type ListObjectVersionsCommandOutput,
  type ListObjectsV2CommandOutput,
} from '@aws-sdk/client-s3';
import type { INestApplicationContext } from '@nestjs/common';

import type { ResolvedStorageConfig } from '../config/storage-config';
import { StorageConfigService } from '../config/storage-config.service';
import { buildS3ClientConfig, type S3StorageProviderConfig } from '../providers/s3/s3-storage.provider';
import { allKeyPrefixes } from '../storage-key-prefix.registry';

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
  /** The live bucket. */
  bucket: string;
  /** The live provider kind. */
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
 * The S3 client calls the purge makes: `send` of the four commands above.
 *
 * @stability experimental
 */
export interface StoragePurgeClient {
  /** Sends one command; resolves to its output. */
  send(command: unknown): Promise<any>;
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
  /** Builds the S3 client from the live configuration; tests pass a fake. Default: the driver's own `buildS3ClientConfig`. */
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

  // Reuses the driver's own client builder rather than re-deriving endpoint,
  // region and forcePathStyle. A second construction here would be a second
  // opinion about how to reach this bucket.
  const client =
    opts.createClient?.(config) ?? new S3Client(buildS3ClientConfig(config as S3StorageProviderConfig));
  return { kind: 'report', report: await purge(client, config, { dryRun: !confirm }) };
}

/**
 * The `npm run storage:purge` command line over {@link runStoragePurge}:
 * `--confirm` and `--bucket <typed>` parsed from `argv`, the JSON written to
 * `stdout`, a refusal to `stderr`. Output and exit codes unchanged since #404.
 *
 * @param app - the booted application context.
 * @param argv - the process arguments (`process.argv`).
 * @param io - where to write; defaults to the process streams.
 * @returns the exit code: 0, or 2 for a refused confirmation.
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
  io.stdout(`${JSON.stringify(outcome.report, null, 2)}\n`);
  return 0;
}

async function purge(
  client: StoragePurgeClient,
  config: ResolvedStorageConfig,
  options: { dryRun: boolean },
): Promise<StoragePurgeReport> {
  const versioning = await readVersioning(client, config.bucket);

  const prefixes: StoragePurgePrefixReport[] = [];
  let deleted = 0;

  // ⚠ Targets come ONLY from the application's own list (every prefix in the
  // storage key-prefix registry, platform and app), never from a listing of
  // the whole bucket filtered afterwards. A filter can be inverted by a later
  // edit; enumerating a fixed list cannot be. Root prefixes cover both key
  // layouts (legacy `uploads/<timestamp>/` and `uploads/<orgId>/`).
  for (const prefix of allKeyPrefixes()) {
    const report: StoragePurgePrefixReport = { prefix, objects: 0, bytes: 0 };

    if (versioning === 'unversioned') {
      deleted += await sweepObjects(client, config.bucket, prefix, report, options.dryRun);
    } else {
      // Versioned, OR the status could not be read. Every version and delete
      // marker goes by id: a plain DeleteObject on a versioned bucket adds a
      // marker and leaves the data, while reporting success.
      deleted += await sweepVersions(client, config.bucket, prefix, report, options.dryRun);
    }

    prefixes.push(report);
  }

  return {
    bucket: config.bucket,
    provider: config.provider,
    endpoint: config.endpoint ?? null,
    versioning,
    prefixes,
    totals: {
      objects: prefixes.reduce((sum, entry) => sum + entry.objects, 0),
      bytes: prefixes.reduce((sum, entry) => sum + entry.bytes, 0),
    },
    deleted,
    dryRun: options.dryRun,
  };
}

/**
 * The bucket's versioning status.
 *
 * ⚠ AN UNREADABLE ANSWER IS TREATED AS VERSIONED. Assuming the cheaper answer
 * is exactly what produces silent retention -- the purge would report complete
 * having left every version in place -- and silent retention is the one outcome
 * this must never produce. Reported as `unknown` so the operator sees which
 * branch was taken.
 */
async function readVersioning(
  client: StoragePurgeClient,
  bucket: string,
): Promise<'enabled' | 'suspended' | 'unversioned' | 'unknown'> {
  try {
    const result: GetBucketVersioningCommandOutput = await client.send(new GetBucketVersioningCommand({ Bucket: bucket }));
    if (result.Status === 'Enabled') return 'enabled';
    if (result.Status === 'Suspended') return 'suspended';
    return 'unversioned';
  } catch {
    return 'unknown';
  }
}

/** Plain objects, for a bucket known not to be versioned. */
async function sweepObjects(
  client: StoragePurgeClient,
  bucket: string,
  prefix: string,
  report: StoragePurgePrefixReport,
  dryRun: boolean,
): Promise<number> {
  let token: string | undefined;
  let deleted = 0;

  do {
    const page: ListObjectsV2CommandOutput = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
    );

    const objects = page.Contents ?? [];
    for (const object of objects) {
      report.objects += 1;
      report.bytes += object.Size ?? 0;
    }

    if (!dryRun && objects.length > 0) {
      await client.send(
        new DeleteObjectsCommand({
          Bucket: bucket,
          Delete: { Objects: objects.map((object) => ({ Key: object.Key as string })) },
        }),
      );
      deleted += objects.length;
    }

    token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
  } while (token !== undefined);

  return deleted;
}

/** Every version and delete marker, by id. */
async function sweepVersions(
  client: StoragePurgeClient,
  bucket: string,
  prefix: string,
  report: StoragePurgePrefixReport,
  dryRun: boolean,
): Promise<number> {
  let keyMarker: string | undefined;
  let versionMarker: string | undefined;
  let deleted = 0;

  do {
    const page: ListObjectVersionsCommandOutput = await client.send(
      new ListObjectVersionsCommand({
        Bucket: bucket,
        Prefix: prefix,
        KeyMarker: keyMarker,
        VersionIdMarker: versionMarker,
      }),
    );

    const versions = page.Versions ?? [];
    // Delete markers carry no bytes but MUST still be removed, or the bucket
    // keeps a tombstone for every object the purge claimed to have deleted.
    const markers = page.DeleteMarkers ?? [];

    for (const version of versions) {
      report.objects += 1;
      report.bytes += version.Size ?? 0;
    }

    const targets = [...versions, ...markers].map((entry) => ({
      Key: entry.Key as string,
      VersionId: entry.VersionId as string,
    }));

    if (!dryRun && targets.length > 0) {
      await client.send(
        new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: targets } }),
      );
      deleted += targets.length;
    }

    keyMarker = page.IsTruncated === true ? page.NextKeyMarker : undefined;
    versionMarker = page.IsTruncated === true ? page.NextVersionIdMarker : undefined;
  } while (keyMarker !== undefined || versionMarker !== undefined);

  return deleted;
}
