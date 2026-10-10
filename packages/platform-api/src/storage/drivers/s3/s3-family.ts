// =============================================================================
// The S3-family storage drivers: `s3`, `r2` and `s3compatible` (PP-14.7, #925)
// =============================================================================
//
// The three object stores the platform ships are ONE driver implementation
// parameterised by an `S3FlavourSpec` (`./s3-config.ts`): what the flavour
// requires, how it derives an endpoint, which region it falls back to. Each
// flavour is a `StorageDriverDefinition` registered through
// `registerStorageDriver` exactly as an app's driver is
// (`../builtin-storage-drivers.ts`); everything S3-specific lives under
// `drivers/s3/` and nothing else in the slice names the AWS SDK.
//
// SETTINGS are each flavour's own `z.object` (R2 has an `accountId` the other
// two do not); the SECRET is `secretAccessKey`, stored at `(purpose 'storage',
// name 'default')` as it has been since #373, so no stored credential moves.
// =============================================================================

import { ListObjectsV2Command, S3Client, type ListObjectsV2CommandOutput } from '@aws-sdk/client-s3';
import { z } from 'zod';

import { S3StorageProvider, buildS3ClientConfig } from '../../providers/s3/s3-storage.provider';
import { STORAGE_CREDENTIAL_LABEL, STORAGE_CREDENTIAL_NAME, STORAGE_CREDENTIAL_PURPOSE } from '../../storage-credential.constants';
import { StorageNotConfiguredError } from '../../config/storage-not-configured.error';
import type { StorageDriverContext, StorageDriverDefinition, StorageDriverLocation } from '../storage-driver';
import { S3_FLAVOURS, resolveS3Config, type S3FamilySettings, type S3FlavourSpec } from './s3-config';
import { testS3Connection } from './s3-connection-test';
import { provisionS3Bucket } from './s3-provision';
import { purgeS3 } from './s3-purge';

const bucketField = z
  .string()
  .trim()
  .max(255)
  .meta({ label: 'Bucket' })
  .describe('The bucket objects are written to and read from. There is no default; empty means storage is not configured.');
const regionField = (help: string) => z.string().trim().max(255).meta({ label: 'Region' }).describe(help);
const endpointField = (help: string) => z.string().trim().max(512).meta({ label: 'Endpoint' }).describe(help);
const accessKeyIdField = z
  .string()
  .trim()
  .max(255)
  .meta({ label: 'Access key ID' })
  .describe('The identifier half of the credential. It is not a secret; the secret access key is saved separately and never shown again.');
const forcePathStyleField = z
  .boolean()
  .nullable()
  .meta({ label: 'Force path style' })
  .describe('Address objects as host/bucket/key instead of bucket.host/key. Leave unset to use this vendor\'s convention.');

const s3SettingsSchema = z.object({
  bucket: bucketField,
  region: regionField('The AWS region the bucket lives in. Required: there is no default.'),
  endpoint: endpointField('Leave empty for AWS. Set it to point at a local MinIO or another S3-compatible server.'),
  accessKeyId: accessKeyIdField,
  forcePathStyle: forcePathStyleField,
});

const r2SettingsSchema = z.object({
  bucket: bucketField,
  accountId: z
    .string()
    .trim()
    .max(255)
    .meta({ label: 'Account ID' })
    .describe('The Cloudflare account id. The endpoint is derived from it unless you type one.'),
  region: regionField('Leave empty for R2 (it signs with "auto"); set it only for a jurisdiction-restricted bucket.'),
  endpoint: endpointField('Leave empty to derive https://<account id>.r2.cloudflarestorage.com.'),
  accessKeyId: accessKeyIdField,
  forcePathStyle: forcePathStyleField,
});

const s3CompatibleSettingsSchema = z.object({
  bucket: bucketField,
  region: regionField('Optional for most servers (MinIO, Ceph ignore it); some vendors require their own region.'),
  endpoint: endpointField('Required: the server\'s URL, for example https://minio.internal:9000.'),
  accessKeyId: accessKeyIdField,
  forcePathStyle: forcePathStyleField,
});

const EMPTY_S3_SETTINGS: S3FamilySettings = {
  bucket: '',
  region: '',
  endpoint: '',
  accountId: '',
  accessKeyId: '',
  forcePathStyle: null,
};

/** A built-in's settings as the S3 code wants them: every field present. */
function s3SettingsOf(settings: Record<string, unknown>): S3FamilySettings {
  return { ...EMPTY_S3_SETTINGS, ...settings } as S3FamilySettings;
}

/** The endpoint a client would actually be pointed at, or `null` for the SDK's own host. */
function effectiveEndpoint(flavour: S3FlavourSpec, settings: S3FamilySettings): string | null {
  return settings.endpoint || flavour.deriveEndpoint?.(settings) || null;
}

async function* listS3Keys(flavour: S3FlavourSpec, ctx: StorageDriverContext<Record<string, unknown>>, prefix: string): AsyncIterable<string> {
  const settings = s3SettingsOf(ctx.settings);
  const resolution = resolveS3Config(flavour, settings, await ctx.secret('secretAccessKey'));
  if (!resolution.configured) {
    throw new Error(`Cannot list keys: the ${flavour.id} configuration is missing ${resolution.missing.join(', ')}.`);
  }

  const client = new S3Client(buildS3ClientConfig(resolution.config));
  try {
    let token: string | undefined;
    do {
      const page: ListObjectsV2CommandOutput = await client.send(
        new ListObjectsV2Command({ Bucket: settings.bucket, Prefix: prefix, ContinuationToken: token }),
      );
      for (const object of page.Contents ?? []) {
        if (object.Key !== undefined) yield object.Key;
      }
      token = page.IsTruncated === true ? page.NextContinuationToken : undefined;
    } while (token !== undefined);
  } finally {
    client.destroy();
  }
}

/**
 * Builds one built-in S3 flavour's driver definition.
 *
 * @param flavour - the flavour's rules.
 * @param meta - its label, description and settings.
 * @returns a definition for `registerStorageDriver`.
 *
 * @stability experimental
 */
function defineS3FamilyDriver(
  flavour: S3FlavourSpec,
  meta: { label: string; description: string; settingsSchema: z.ZodObject<z.ZodRawShape> },
): StorageDriverDefinition<Record<string, unknown>> {
  const defaults = meta.settingsSchema.parse(
    Object.fromEntries(Object.keys(meta.settingsSchema.shape).map((key) => [key, EMPTY_S3_SETTINGS[key as keyof S3FamilySettings]])),
  ) as Record<string, unknown>;

  return {
    id: flavour.id,
    label: meta.label,
    description: meta.description,
    settingsSchema: meta.settingsSchema,
    defaults,
    secrets: [
      {
        name: 'secretAccessKey',
        label: 'Secret access key',
        required: true,
        help: 'Write-only: saved encrypted, never shown again. Leave blank to keep the stored one.',
      },
    ],
    // The secret access key has lived at `(storage, default)` since #373; the
    // purpose is registered by the storage slice's own credential manifest.
    credentialAddress: () => ({ purpose: STORAGE_CREDENTIAL_PURPOSE, name: STORAGE_CREDENTIAL_NAME, label: STORAGE_CREDENTIAL_LABEL }),
    defaultRegion: flavour.fallbackRegion || undefined,
    async build(ctx) {
      const settings = s3SettingsOf(ctx.settings);
      const resolution = resolveS3Config(flavour, settings, await ctx.secret('secretAccessKey'));
      if (!resolution.configured) throw StorageNotConfiguredError.missing(flavour.id, resolution.missing);

      const { config } = resolution;
      return new S3StorageProvider({
        provider: config.provider,
        bucket: config.bucket,
        region: config.region,
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
        forcePathStyle: config.forcePathStyle,
        partSize: ctx.partSize,
      });
    },
    testConnection: (ctx) => testS3Connection({ ...ctx, settings: s3SettingsOf(ctx.settings) }, flavour),
    provision: (ctx) => provisionS3Bucket({ ...ctx, settings: s3SettingsOf(ctx.settings) }, flavour),
    listKeys: (ctx, prefix) => listS3Keys(flavour, ctx, prefix),
    purge: (ctx, input) => purgeS3({ ...ctx, settings: s3SettingsOf(ctx.settings) }, flavour, input),
    location(settings): StorageDriverLocation {
      const s3 = s3SettingsOf(settings);
      return { bucket: s3.bucket, endpoint: effectiveEndpoint(flavour, s3), region: s3.region || flavour.fallbackRegion };
    },
    missing(settings, secrets) {
      const resolution = resolveS3Config(flavour, s3SettingsOf(settings), secrets.secretAccessKey === true ? 'stored' : null);
      return resolution.configured ? [] : resolution.missing;
    },
    egressHosts(settings) {
      const s3 = s3SettingsOf(settings);
      return [effectiveEndpoint(flavour, s3) || (s3.region ? `s3.${s3.region}.amazonaws.com` : 's3.amazonaws.com')];
    },
  };
}

/**
 * The `s3` driver: Amazon S3.
 *
 * @stability experimental
 */
export const s3StorageDriver = defineS3FamilyDriver(S3_FLAVOURS.s3, {
  label: 'Amazon S3',
  description: 'AWS S3. The region is required; the endpoint is left empty and the SDK derives it.',
  settingsSchema: s3SettingsSchema,
});

/**
 * The `r2` driver: Cloudflare R2.
 *
 * @stability experimental
 */
export const r2StorageDriver = defineS3FamilyDriver(S3_FLAVOURS.r2, {
  label: 'Cloudflare R2',
  description: 'Cloudflare R2. The endpoint is derived from the account id; the region is "auto".',
  settingsSchema: r2SettingsSchema,
});

/**
 * The `s3compatible` driver: MinIO, Backblaze B2, Wasabi, Ceph RGW and anything else speaking S3 at an endpoint you supply.
 *
 * @stability experimental
 */
export const s3CompatibleStorageDriver = defineS3FamilyDriver(S3_FLAVOURS.s3compatible, {
  label: 'S3-compatible',
  description: 'MinIO, Backblaze B2, Wasabi, Ceph and other S3-compatible servers at an endpoint you supply.',
  settingsSchema: s3CompatibleSettingsSchema,
});
