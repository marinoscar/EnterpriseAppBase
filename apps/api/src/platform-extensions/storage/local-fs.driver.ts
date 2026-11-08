import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { deriveSigningKey } from '@marinoscar/platform-api/core';
import {
  MultipartPartsMissingError,
  MultipartSessionNotFoundError,
  PartSizeMismatchError,
  normalizeEtag,
  type SignedPutUrlOptions,
  type SignedUrlOptions,
  type StorageDriverDefinition,
  type StorageDriverTestResult,
  type StoragePartUploadMode,
  type StorageProvider,
  type StorageUploadOptions,
  type StorageUploadResult,
  type UploadPart,
  type UploadedPart,
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
//   <directory>/.parts/<uploadId>/     a resumable upload in flight: one file per part
//                                      (`<n>`, with its MD5 beside it in `<n>.etag`)
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
// RESUMABLE UPLOADS, THROUGH THE API. A disk has no presigned URLs, so the driver
// declares `partUploadMode: 'proxied'`: `upload/init` and `upload/part-urls` hand
// the client the API's own part route (`partUploadAuth: 'bearer'`), the platform
// streams each part into `uploadPart` (bounded to the exact part size, never
// buffered), and `listUploadedParts` reports the part files on disk so a client
// that crashed mid-upload resumes from what really arrived. `completeMultipartUpload`
// concatenates the parts into the object in one streamed pass. The app must call
// `registerStoragePartBodyParser` in `main.ts` for the part route to receive its body.
//
// NOT SUPPORTED, DECLARED RATHER THAN HIDDEN: signed PUT URLs (`getSignedPutUrl`)
// raise a clear error. Server-side uploads (profile images, exports, backups, node
// output) use `upload` and are fully supported.
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
  /** The `Cache-Control` the object was written with (#1124), when one was asked for. */
  cacheControl?: string;
}

function unsupported(operation: string): never {
  throw new Error(`The local-fs storage driver does not support ${operation}. Server-side uploads (upload) are supported.`);
}

/** A multipart upload id is one of ours (a UUID), never a path. */
const UPLOAD_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * The `StorageProvider` of the `local-fs` driver: objects as files under one directory.
 */
export class LocalFsStorageProvider implements StorageProvider {
  readonly kind = LOCAL_FS_DRIVER_ID;

  /** No presigned URLs on a disk: parts come through the API's part route. */
  readonly partUploadMode: StoragePartUploadMode = 'proxied';

  private readonly objects: string;
  private readonly meta: string;
  private readonly tmp: string;
  private readonly parts: string;

  constructor(
    private readonly directory: string,
    private readonly appOrigin: string = '',
  ) {
    this.objects = join(directory, 'objects');
    this.meta = join(directory, '.meta');
    this.tmp = join(directory, '.tmp');
    this.parts = join(directory, '.parts');
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

    const meta: ObjectMeta = {
      mimeType: options.mimeType,
      metadata: { ...(options.metadata ?? {}) },
      ...(options.cacheControl ? { cacheControl: options.cacheControl } : {}),
    };
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

  /** The object's size from the file system, `null` when absent (#1124). */
  async size(key: string): Promise<number | null> {
    const info = await stat(this.pathOf(key)).catch(() => null);
    return info?.isFile() ? info.size : null;
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

  /** The `Cache-Control` recorded when the object was written, for whatever serves its bytes; `null` when none (#1124). */
  async cacheControlOf(key: string): Promise<string | null> {
    return (await this.readMeta(key)).cacheControl ?? null;
  }

  // ---- resumable uploads, through the API ----------------------------------------

  private partsDirOf(uploadId: string): string {
    if (!UPLOAD_ID_PATTERN.test(uploadId)) throw new MultipartSessionNotFoundError(uploadId);
    return join(this.parts, uploadId);
  }

  async initMultipartUpload(key: string, options: StorageUploadOptions): Promise<{ uploadId: string; key: string }> {
    this.pathOf(key);
    const uploadId = randomUUID();
    const directory = join(this.parts, uploadId);
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, 'upload.json'),
      JSON.stringify({ key, mimeType: options.mimeType, metadata: options.metadata ?? {}, cacheControl: options.cacheControl }),
    );
    return { uploadId, key };
  }

  /** Never called: parts go through the API (`partUploadMode: 'proxied'`). */
  getSignedUploadUrl(): Promise<never> {
    return unsupported('presigned part URLs (parts are uploaded through the API)');
  }

  async uploadPart(_key: string, uploadId: string, partNumber: number, body: Readable, size: number): Promise<{ eTag: string }> {
    const directory = this.partsDirOf(uploadId);
    if (!(await stat(join(directory, 'upload.json')).catch(() => null))) throw new MultipartSessionNotFoundError(uploadId);

    const staged = join(directory, `${partNumber}.tmp`);
    const digest = createHash('md5');
    let received = 0;
    const counting = new Transform({
      transform(chunk, _encoding, callback) {
        received += (chunk as Buffer).length;
        digest.update(chunk);
        callback(null, chunk);
      },
    });

    try {
      // Streamed to a temp file: a part that fails (or is short) leaves nothing behind.
      await pipeline(body, counting, createWriteStream(staged));
      if (received !== size) throw new PartSizeMismatchError(partNumber, size, received, received > size);
      const eTag = digest.digest('hex');
      await writeFile(join(directory, `${partNumber}.etag`), eTag);
      await rename(staged, join(directory, String(partNumber)));
      return { eTag };
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }
  }

  async listUploadedParts(_key: string, uploadId: string): Promise<UploadedPart[]> {
    const directory = this.partsDirOf(uploadId);
    const entries = await readdir(directory).catch(() => null);
    if (entries === null) throw new MultipartSessionNotFoundError(uploadId);

    const held: UploadedPart[] = [];
    for (const name of entries.filter((entry) => /^\d+$/.test(entry))) {
      const info = await stat(join(directory, name));
      const eTag = await readFile(join(directory, `${name}.etag`), 'utf8').catch(() => '');
      held.push({ partNumber: Number(name), size: info.size, eTag });
    }
    return held.sort((a, b) => a.partNumber - b.partNumber);
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: UploadPart[]): Promise<StorageUploadResult> {
    const directory = this.partsDirOf(uploadId);
    const held = new Map((await this.listUploadedParts(key, uploadId)).map((part) => [part.partNumber, part]));
    const ordered = [...parts].sort((a, b) => a.partNumber - b.partNumber);

    const missing = ordered.filter((part) => held.get(part.partNumber)?.eTag !== normalizeEtag(part.eTag)).map((part) => part.partNumber);
    if (missing.length > 0) throw new MultipartPartsMissingError(missing);

    const target = this.pathOf(key);
    const info = JSON.parse(await readFile(join(directory, 'upload.json'), 'utf8')) as {
      mimeType?: string;
      metadata?: Record<string, string>;
      cacheControl?: string;
    };
    await mkdir(this.tmp, { recursive: true });
    await mkdir(dirname(target), { recursive: true });

    // One streamed pass over the part files, in order: never the whole object in memory.
    const staged = join(this.tmp, randomUUID());
    try {
      await pipeline(
        Readable.from(
          (async function* () {
            for (const part of ordered) yield* createReadStream(join(directory, String(part.partNumber)));
          })(),
        ),
        createWriteStream(staged),
      );
      await rename(staged, target);
    } catch (error) {
      await rm(staged, { force: true });
      throw error;
    }

    await this.writeMeta(key, {
      mimeType: info.mimeType ?? 'application/octet-stream',
      metadata: info.metadata ?? {},
      ...(info.cacheControl ? { cacheControl: info.cacheControl } : {}),
    });
    await rm(directory, { recursive: true, force: true });

    return { key, bucket: this.directory, location: `file://${target}` };
  }

  async abortMultipartUpload(_key: string, uploadId: string): Promise<void> {
    await rm(this.partsDirOf(uploadId), { recursive: true, force: true });
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
      return {
        mimeType: parsed.mimeType ?? 'application/octet-stream',
        metadata: parsed.metadata ?? {},
        ...(typeof parsed.cacheControl === 'string' ? { cacheControl: parsed.cacheControl } : {}),
      };
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
