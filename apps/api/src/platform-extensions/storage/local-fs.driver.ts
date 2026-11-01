import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { deriveSigningKey } from '@marinoscar/platform-api/core';
import type {
  SignedPutUrlOptions,
  SignedUrlOptions,
  StorageDriverDefinition,
  StorageDriverTestResult,
  StorageProvider,
  StorageUploadOptions,
  StorageUploadResult,
} from '@marinoscar/platform-api/storage';
import { z } from 'zod';

// =============================================================================
// EXAMPLE: a storage driver an app adds without touching a package (PP-14.7, #925)
// =============================================================================
//
// `local-fs` keeps every object as a file under one directory on the API host:
// no cloud account, no network, no secret. It is the smallest complete driver,
// and the one the example specs (`test/examples/storage/local-fs-driver.spec.ts`)
// run the conformance kit and the storage consumers against.
//
// WHAT A DRIVER IS. A definition (`id`, `label`, `settingsSchema`, `defaults`,
// `secrets`) that the admin page renders as a generated form, and the operations
// the slice calls: `build` (the `StorageProvider` every consumer shares),
// `testConnection` (the admin "Test connection" button: it NEVER throws), and,
// optionally, `provision`, `listKeys`, `location`, `missing`. It is registered
// once, at import time, from `app-registrations/storage.ts`; from then on an
// administrator can pick it at /admin/settings/storage, and the objects API,
// profile images, exports, database backups and the node object store all write
// through it.
//
// LAYOUT ON DISK
//
//   <directory>/objects/<key>          the bytes (keys keep their `/` as folders)
//   <directory>/.meta/<key>.json       the content type and the object's metadata
//   <directory>/.tmp/<uuid>            uploads in flight, renamed into place when complete
//
// Writes are streamed (`pipeline` into a temp file, then one `rename`), so an
// upload is never held in memory and a reader never sees half an object.
//
// SIGNED URLS. `getSignedDownloadUrl` returns `<origin>/api/local-fs/objects/<token>`,
// where the token is `base64url(payload).base64url(mac)` and the mac is an
// HMAC-SHA256 under `deriveSigningKey('local-fs-driver')`: a sub-key of
// `SECRETS_ENCRYPTION_KEY`, so there is no new secret and no environment
// variable. `verifyLocalFsToken` is the other half; a deployment that selects
// this driver mounts a route that calls it and streams the object (see the
// README of the example). The app mounts no such route by default: the driver is
// OFF until selected, and a route nothing needs would be surface for nothing.
//
// NOT SUPPORTED, DECLARED RATHER THAN HIDDEN: browser-direct multipart uploads
// (`initMultipartUpload`, `getSignedUploadUrl`, ...) and signed PUT URLs need a
// route that accepts parts; they raise a clear error. Server-side uploads (profile
// images, exports, backups, node output) use `upload` and are fully supported.
// =============================================================================

/** The signing domain of this driver's URLs. A label, permanent in practice (links live minutes). */
export const LOCAL_FS_SIGNING_PURPOSE = 'local-fs-driver';

/** The path the signed URLs point at, under the API prefix. */
export const LOCAL_FS_URL_PATH = '/api/local-fs/objects/';

/** The driver id: the key of `storage.drivers`, `StorageProvider.kind`, and `storage_objects.storage_provider`. */
export const LOCAL_FS_DRIVER_ID = 'local-fs';

const DEFAULT_DIRECTORY_NAME = 'enterpriseappbase-local-fs-storage';
const DEFAULT_URL_TTL_SECONDS = 3600;

/** The settings of the driver: where on the host the objects live. */
export const localFsSettingsSchema = z.object({
  directory: z
    .string()
    .trim()
    .max(512)
    .meta({ label: 'Directory' })
    .describe('Absolute path of the folder the objects are written under. Leave empty for a folder in the system temp directory.'),
});

/** The parsed settings. */
export type LocalFsSettings = z.infer<typeof localFsSettingsSchema>;

/** The directory in force: the configured one, else a folder under the system temp directory. */
export function resolveLocalFsDirectory(settings: Pick<LocalFsSettings, 'directory'>): string {
  return resolve(settings.directory === '' ? join(tmpdir(), DEFAULT_DIRECTORY_NAME) : settings.directory);
}

// ---- signed tokens -----------------------------------------------------------------

function mac(payload: string): Buffer {
  return createHmac('sha256', deriveSigningKey(LOCAL_FS_SIGNING_PURPOSE)).update(payload).digest();
}

/**
 * Signs a token granting a read of `key` until `expiresAt` (epoch seconds).
 *
 * @param key - the object key.
 * @param expiresAt - when the token stops working, epoch seconds.
 */
export function signLocalFsToken(key: string, expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ k: key, e: expiresAt })).toString('base64url');
  return `${payload}.${mac(payload).toString('base64url')}`;
}

/** What {@link verifyLocalFsToken} answers. */
export type LocalFsTokenVerdict = { ok: true; key: string } | { ok: false; reason: 'invalid' | 'expired' };

/**
 * Verifies a token: well formed, signed by this deployment, not expired.
 *
 * @param token - the last path segment of a signed URL.
 * @param nowSeconds - the clock, epoch seconds (tests).
 */
export function verifyLocalFsToken(token: string, nowSeconds: number = Math.floor(Date.now() / 1000)): LocalFsTokenVerdict {
  const [payload, signature, ...extra] = token.split('.');
  if (!payload || !signature || extra.length > 0) return { ok: false, reason: 'invalid' };

  const expected = mac(payload);
  const actual = Buffer.from(signature, 'base64url');
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return { ok: false, reason: 'invalid' };

  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { k?: unknown; e?: unknown };
    if (typeof claims.k !== 'string' || typeof claims.e !== 'number') return { ok: false, reason: 'invalid' };
    return claims.e < nowSeconds ? { ok: false, reason: 'expired' } : { ok: true, key: claims.k };
  } catch {
    return { ok: false, reason: 'invalid' };
  }
}

// ---- the provider ------------------------------------------------------------------

interface ObjectMeta {
  mimeType: string;
  metadata: Record<string, string>;
}

function unsupported(operation: string): never {
  throw new Error(`The local-fs storage driver does not support ${operation}: it needs a route that accepts the parts. Server-side uploads (upload) are supported.`);
}

/**
 * The `StorageProvider` of the `local-fs` driver: objects as files under one directory.
 */
export class LocalFsStorageProvider implements StorageProvider {
  readonly kind = LOCAL_FS_DRIVER_ID;

  private readonly objects: string;
  private readonly meta: string;
  private readonly tmp: string;

  constructor(
    private readonly directory: string,
    private readonly appOrigin: string = '',
  ) {
    this.objects = join(directory, 'objects');
    this.meta = join(directory, '.meta');
    this.tmp = join(directory, '.tmp');
  }

  /** The folder the objects live in; also what `getBucket()` reports. */
  getBucket(): string {
    return this.directory;
  }

  private pathOf(key: string): string {
    if (key === '' || key.includes('\0') || key.includes('\\') || key.startsWith('/') || key.split('/').some((part) => part === '..' || part === '.')) {
      throw new Error(`Refusing the object key ${JSON.stringify(key)}: keys are relative paths without "." or ".." segments.`);
    }
    const path = resolve(this.objects, key);
    if (!path.startsWith(this.objects + sep)) throw new Error(`Refusing the object key ${JSON.stringify(key)}: it escapes the storage directory.`);
    return path;
  }

  private metaPathOf(key: string): string {
    this.pathOf(key);
    return join(this.meta, `${key}.json`);
  }

  async upload(key: string, stream: Readable, options: StorageUploadOptions): Promise<StorageUploadResult> {
    const target = this.pathOf(key);
    await mkdir(this.tmp, { recursive: true });
    await mkdir(dirname(target), { recursive: true });

    const staged = join(this.tmp, randomUUID());
    const digest = createHash('sha256');
    const hashing = new Transform({
      transform(chunk, _encoding, callback) {
        digest.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      await pipeline(stream, hashing, createWriteStream(staged));
      await rename(staged, target);
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }

    const meta: ObjectMeta = { mimeType: options.mimeType, metadata: { ...(options.metadata ?? {}) } };
    await this.writeMeta(key, meta);

    return { key, bucket: this.directory, location: `file://${target}`, eTag: `"${digest.digest('hex')}"` };
  }

  async download(key: string): Promise<Readable> {
    const path = this.pathOf(key);
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new Error(`No such object: ${key}`);
    return createReadStream(path);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathOf(key), { force: true });
    await rm(this.metaPathOf(key), { force: true });
  }

  async exists(key: string): Promise<boolean> {
    return (await stat(this.pathOf(key)).catch(() => null))?.isFile() === true;
  }

  async getMetadata(key: string): Promise<Record<string, string> | null> {
    if (!(await this.exists(key))) return null;
    return (await this.readMeta(key)).metadata;
  }

  async setMetadata(key: string, metadata: Record<string, string>): Promise<void> {
    if (!(await this.exists(key))) throw new Error(`No such object: ${key}`);
    const current = await this.readMeta(key);
    await this.writeMeta(key, { ...current, metadata: { ...metadata } });
  }

  async getSignedDownloadUrl(key: string, options?: SignedUrlOptions): Promise<string> {
    this.pathOf(key);
    const expiresAt = Math.floor(Date.now() / 1000) + (options?.expiresIn ?? DEFAULT_URL_TTL_SECONDS);
    return `${this.appOrigin}${LOCAL_FS_URL_PATH}${signLocalFsToken(key, expiresAt)}`;
  }

  /** The content type recorded when the object was written (`application/octet-stream` when unknown). */
  async contentTypeOf(key: string): Promise<string> {
    return (await this.readMeta(key)).mimeType;
  }

  // Browser-direct uploads need a route that accepts parts: not supported here.
  initMultipartUpload(): Promise<never> {
    return unsupported('browser multipart uploads (initMultipartUpload)');
  }

  getSignedUploadUrl(): Promise<never> {
    return unsupported('browser multipart uploads (getSignedUploadUrl)');
  }

  completeMultipartUpload(): Promise<never> {
    return unsupported('browser multipart uploads (completeMultipartUpload)');
  }

  abortMultipartUpload(): Promise<never> {
    return unsupported('browser multipart uploads (abortMultipartUpload)');
  }

  getSignedPutUrl(_key: string, _options?: SignedPutUrlOptions): Promise<never> {
    return unsupported('signed PUT URLs');
  }

  /** Every key under `prefix`, `/`-separated, in no particular order. */
  async *keys(prefix: string): AsyncIterable<string> {
    const walk = async function* (folder: string, relative: string): AsyncIterable<string> {
      const entries = await readdir(folder, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const next = relative === '' ? entry.name : `${relative}/${entry.name}`;
        if (entry.isDirectory()) yield* walk(join(folder, entry.name), next);
        else if (entry.isFile() && next.startsWith(prefix)) yield next;
      }
    };
    yield* walk(this.objects, '');
  }

  private async readMeta(key: string): Promise<ObjectMeta> {
    try {
      const parsed = JSON.parse(await readFile(this.metaPathOf(key), 'utf8')) as Partial<ObjectMeta>;
      return { mimeType: parsed.mimeType ?? 'application/octet-stream', metadata: parsed.metadata ?? {} };
    } catch {
      return { mimeType: 'application/octet-stream', metadata: {} };
    }
  }

  private async writeMeta(key: string, meta: ObjectMeta): Promise<void> {
    const path = this.metaPathOf(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, JSON.stringify(meta));
  }
}

// ---- the definition ----------------------------------------------------------------

/**
 * The `local-fs` storage driver: register it with `registerStorageDriver` (see
 * `app-registrations/storage.ts`).
 */
export const localFsStorageDriver: StorageDriverDefinition<LocalFsSettings> = {
  id: LOCAL_FS_DRIVER_ID,
  label: 'Local filesystem',
  description: 'Objects as files in a folder on the API host. For development, demos and single-node installs; no cloud account needed.',
  settingsSchema: localFsSettingsSchema,
  defaults: { directory: '' },

  build: ({ settings, appOrigin }) => new LocalFsStorageProvider(resolveLocalFsDirectory(settings), appOrigin ?? ''),

  // The admin "Test connection": write a probe, read it back, delete it. Never throws.
  async testConnection({ settings }): Promise<StorageDriverTestResult> {
    const directory = resolveLocalFsDirectory(settings);
    const probe = join(directory, '.tmp', `probe-${randomUUID()}`);
    const body = `local-fs probe ${randomUUID()}`;

    try {
      await mkdir(dirname(probe), { recursive: true });
      await writeFile(probe, body);
      const readBack = await readFile(probe, 'utf8');
      await rm(probe, { force: true });

      return readBack === body
        ? { ok: true, message: `Wrote, read back and deleted a probe file in ${directory}.`, details: { directory, writable: true } }
        : { ok: false, message: `The probe file in ${directory} read back different bytes than were written.`, details: { directory } };
    } catch (error) {
      await rm(probe, { force: true }).catch(() => undefined);
      const code = (error as NodeJS.ErrnoException)?.code;
      return {
        ok: false,
        message: `Cannot write to ${directory}${code ? ` (${code})` : ''}: create it, or give the API's user write access to it.`,
        details: { directory, writable: false },
      };
    }
  },

  // "Create the bucket": make the directory tree. Safe to repeat.
  async provision({ settings }) {
    const directory = resolveLocalFsDirectory(settings);
    const existed = await stat(join(directory, 'objects')).then(() => true, () => false);
    await mkdir(join(directory, 'objects'), { recursive: true });
    await mkdir(join(directory, '.meta'), { recursive: true });
    await mkdir(join(directory, '.tmp'), { recursive: true });

    return {
      created: !existed,
      message: existed ? `${directory} already exists; it was left as it is.` : `Created ${directory}.`,
    };
  },

  // `npm run storage:purge` lists with this, then deletes each key through the provider.
  async *listKeys({ settings }, prefix) {
    yield* new LocalFsStorageProvider(resolveLocalFsDirectory(settings)).keys(prefix);
  },

  // Rows record the directory as the "bucket".
  location: (settings) => ({ bucket: resolveLocalFsDirectory(settings) }),

  // A directory is always usable (the default is a folder in the temp directory): nothing is required.
  missing: () => [],
};
