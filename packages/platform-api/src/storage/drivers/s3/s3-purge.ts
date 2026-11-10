// =============================================================================
// The built-in S3 drivers' purge (issue #404; PP-14.7)
// =============================================================================
//
// What `npm run storage:purge` does to an S3-family bucket: count (dry run) or
// delete every object under the registered key prefixes, VERSION-AWARE. A
// versioned bucket keeps every object version and a delete marker for each
// deletion, so `DeleteObject` on a listing leaves the data behind while
// reporting success; versions are enumerated and removed by id. When the
// versioning status cannot be READ the bucket is treated as VERSIONED, because
// assuming the cheaper answer produces silent retention, the one outcome a
// purge must never produce. Moved here from `purge/run-storage-purge.ts` with
// its comments when the S3 SDK became a concern of the drivers alone.
// =============================================================================

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

import { buildS3ClientConfig } from '../../providers/s3/s3-storage.provider';
import type {
  StorageDriverContext,
  StorageDriverPurgePrefixReport,
  StorageDriverPurgeResult,
} from '../storage-driver';
import { resolveS3Config, type S3FamilySettings, type S3FlavourSpec } from './s3-config';

/**
 * The S3 client calls the purge makes: `send` of the commands below.
 *
 * @stability experimental
 */
export interface StoragePurgeClient {
  /** Sends one command; resolves to its output. */
  send(command: unknown): Promise<any>;
}

type StoragePurgePrefixReport = StorageDriverPurgePrefixReport;

/**
 * Purges (or, with `dryRun`, counts) every object under `prefixes` in an
 * S3-family bucket. Targets come ONLY from the list given, never from a
 * filtered listing of the whole bucket.
 *
 * @param ctx - the driver context.
 * @param flavour - the built-in flavour's rules.
 * @param input - the prefixes, `dryRun`, and a pre-built client (tests).
 * @throws Error when the configuration is incomplete and no client was given.
 *
 * @stability experimental
 */
export async function purgeS3(
  ctx: StorageDriverContext<S3FamilySettings>,
  flavour: S3FlavourSpec,
  input: { prefixes: readonly string[]; dryRun: boolean; client?: unknown },
): Promise<StorageDriverPurgeResult> {
  let client = input.client as StoragePurgeClient | undefined;
  if (client === undefined) {
    // Reuses the driver's own client builder rather than re-deriving endpoint,
    // region and forcePathStyle. A second construction here would be a second
    // opinion about how to reach this bucket.
    const resolution = resolveS3Config(flavour, ctx.settings, await ctx.secret('secretAccessKey'));
    if (!resolution.configured) {
      throw new Error(`Cannot purge: the ${flavour.id} configuration is missing ${resolution.missing.join(', ')}.`);
    }
    client = new S3Client(buildS3ClientConfig(resolution.config));
  }

  const bucket = ctx.settings.bucket;
  const versioning = await readVersioning(client, bucket);

  const prefixes: StoragePurgePrefixReport[] = [];
  let deleted = 0;

  // ⚠ Targets come ONLY from the application's own list (every prefix in the
  // storage key-prefix registry, platform and app), never from a listing of
  // the whole bucket filtered afterwards. A filter can be inverted by a later
  // edit; enumerating a fixed list cannot be. Root prefixes cover both key
  // layouts (legacy `uploads/<timestamp>/` and `uploads/<orgId>/`).
  for (const prefix of input.prefixes) {
    const report: StoragePurgePrefixReport = { prefix, objects: 0, bytes: 0 };

    if (versioning === 'unversioned') {
      deleted += await sweepObjects(client, bucket, prefix, report, input.dryRun);
    } else {
      // Versioned, OR the status could not be read. Every version and delete
      // marker goes by id: a plain DeleteObject on a versioned bucket adds a
      // marker and leaves the data, while reporting success.
      deleted += await sweepVersions(client, bucket, prefix, report, input.dryRun);
    }

    prefixes.push(report);
  }

  return { versioning, prefixes, deleted };
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
