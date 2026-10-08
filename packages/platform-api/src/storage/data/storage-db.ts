// =============================================================================
// The data the storage slice reads and writes, structurally (issue #736)
// =============================================================================
//
// The slice never imports a generated Prisma client, not even its types (the
// rule of identity, settings, sharing and jobs): the package is built,
// type-checked and tested before any app's `prisma generate`, and works with
// any app that composed the `storage` fragment of `@marinoscar/platform-db`
// (`StorageObject`, `StorageObjectChunk`, `StorageObjectStatus`).
//
// TWO CLIENTS, TWO PORTS.
//
//   * The tenant client is the core port `PLATFORM_PRISMA`, seen as
//     {@link StoragePrisma}. `storage_objects` and `storage_object_chunks` are
//     under FORCEd row-level security (#725), so the slice reaches them only
//     through an organization's scope: {@link storageForOrg} and
//     {@link storageRunInOrg} below, which use the client's own `forOrg` /
//     `runInOrg` when it has them (the reference app's `PrismaService`) and
//     core's helpers of the same name otherwise.
//   * The bypass client is `STORAGE_SYSTEM_DATA` (`ports.ts`), for the four
//     reviewed cross-organization reads and writes (the stale-upload sweep,
//     the stranded-object count, the public avatar route, the avatar
//     replacement across an org switch).
//
// The rows mirror the fragment column for column. A column added to the
// fragment is added here in the same change.
// =============================================================================

import { forOrg, runInOrg } from '../../core/index';

/**
 * Prisma's arguments for one delegate call (`where`, `data`, `select`, ...),
 * untyped on purpose: the app's client checks them at run time, and a typed
 * shape here would make the app's generated client unassignable to
 * {@link StoragePrisma}.
 *
 * @stability experimental
 */
export type StorageQueryArgs = any;

/**
 * A JSON column's value, as Prisma reads it (`Prisma.JsonValue`).
 *
 * @stability experimental
 */
export type StorageJsonValue = string | number | boolean | StorageJsonObject | StorageJsonArray | null;

/**
 * A JSON object, as Prisma reads it.
 *
 * @stability experimental
 */
export type StorageJsonObject = { [Key in string]?: StorageJsonValue };

/**
 * A JSON array, as Prisma reads it.
 *
 * @stability experimental
 */
export interface StorageJsonArray extends Array<StorageJsonValue> {}

/**
 * A JSON value a write accepts (`Prisma.InputJsonValue`).
 *
 * @stability experimental
 */
export type StorageInputJsonValue =
  | string
  | number
  | boolean
  | StorageInputJsonObject
  | StorageInputJsonArray
  | {
      /** Serialises the value. */
      toJSON(): unknown;
    };

/**
 * A JSON object a write accepts.
 *
 * @stability experimental
 */
export type StorageInputJsonObject = { readonly [Key in string]?: StorageInputJsonValue | null };

/**
 * A JSON array a write accepts.
 *
 * @stability experimental
 */
export interface StorageInputJsonArray extends ReadonlyArray<StorageInputJsonValue | null> {}

// ---- enums --------------------------------------------------------------------------

/**
 * `StorageObjectStatus`: where an object is in its upload lifecycle.
 *
 * @stability stable
 */
export const StorageObjectStatus: {
  readonly [K in 'pending' | 'uploading' | 'processing' | 'ready' | 'failed']: K;
} = Object.freeze({
  pending: 'pending',
  uploading: 'uploading',
  processing: 'processing',
  ready: 'ready',
  failed: 'failed',
} as const);

/**
 * A {@link StorageObjectStatus} value.
 *
 * @stability stable
 */
export type StorageObjectStatus = (typeof StorageObjectStatus)[keyof typeof StorageObjectStatus];

// ---- rows ---------------------------------------------------------------------------

/**
 * One `storage_objects` row (`StorageObject` in the `storage` fragment).
 * Structurally the app's generated `StorageObject`, so a processor written
 * against the app's type is an `ObjectProcessor` as it is.
 *
 * @stability stable
 */
export interface StorageObject {
  /** The object id (UUID). */
  id: string;
  /** The original filename. */
  name: string;
  /** Total size in bytes. */
  size: bigint;
  /** The declared media type. */
  mimeType: string;
  /**
   * The object key. Stored per row and never rebuilt: a legacy row keeps the
   * layout it was written with (`uploads/<timestamp>/…` before #736).
   */
  storageKey: string;
  /** The provider kind that held it when it was written (`s3`, `r2`, `s3compatible`). */
  storageProvider: string;
  /** The bucket it was written to. */
  bucket: string | null;
  /** Lifecycle status. */
  status: StorageObjectStatus;
  /** The provider's multipart upload id, while a resumable upload is open. */
  s3UploadId: string | null;
  /** Free-form metadata (processing stamps, `purpose: 'avatar'`). */
  metadata: StorageJsonValue | null;
  /** The uploader, or `null` once that user was deleted. */
  uploadedById: string | null;
  /** The organization the object belongs to (row-level security). */
  orgId: string;
  /** Creation. */
  createdAt: Date;
  /** Last update. */
  updatedAt: Date;
}

/**
 * One `storage_object_chunks` row: a recorded part of a multipart upload.
 *
 * @stability stable
 */
export interface StorageObjectChunk {
  /** The row id. */
  id: string;
  /** The parent object. */
  objectId: string;
  /** The part number (1-10000). */
  partNumber: number;
  /** The part's ETag. */
  eTag: string;
  /** The part's size in bytes (0 when the client did not say). */
  size: bigint;
  /** The parent's organization. */
  orgId: string;
  /** When it was recorded. */
  uploadedAt: Date;
}

// ---- delegates ----------------------------------------------------------------------

/**
 * One model delegate of the app's client, structurally. Every method takes
 * Prisma's arguments untyped and resolves to `any` where an `include` or a
 * `select` decides the shape; the call site names what it reads.
 *
 * @typeParam Row - the model's row type.
 *
 * @stability experimental
 */
export interface StorageDelegate<Row> {
  /** `findUnique`. */
  findUnique(args: StorageQueryArgs): Promise<Row | null>;
  /** `findUniqueOrThrow`. */
  findUniqueOrThrow(args: StorageQueryArgs): Promise<Row>;
  /** `findFirst`. */
  findFirst(args?: StorageQueryArgs): Promise<Row | null>;
  /** `findMany`. */
  findMany(args?: StorageQueryArgs): Promise<Row[]>;
  /** `create`. */
  create(args: StorageQueryArgs): Promise<Row>;
  /** `update`. */
  update(args: StorageQueryArgs): Promise<Row>;
  /** `upsert`. */
  upsert(args: StorageQueryArgs): Promise<Row>;
  /** `delete`. */
  delete(args: StorageQueryArgs): Promise<Row>;
  /** `updateMany`. */
  updateMany(args: StorageQueryArgs): Promise<{ count: number }>;
  /** `deleteMany`. */
  deleteMany(args?: StorageQueryArgs): Promise<{ count: number }>;
  /** `count`. */
  count(args?: StorageQueryArgs): Promise<number>;
}

/**
 * The transaction client (or org-scoped client) the slice works with: the
 * storage fragment's two models.
 *
 * @stability experimental
 */
export interface StorageTx {
  /** `storage_objects`. */
  storageObject: StorageDelegate<StorageObject>;
  /** `storage_object_chunks`. */
  storageObjectChunk: StorageDelegate<StorageObjectChunk>;
}

/**
 * Options of {@link storageRunInOrg}: the acting user and Prisma's
 * transaction bounds.
 *
 * @stability experimental
 */
export interface StorageRunInOrgOptions {
  /** The acting user; becomes `app.user_id`. */
  userId?: string;
  /** Prisma's `maxWait`. */
  maxWait?: number;
  /** Prisma's `timeout`. */
  timeout?: number;
}

/**
 * The app's tenant Prisma client as the storage slice sees it (the core port
 * `PLATFORM_PRISMA`). Besides the storage models it reads four tables the
 * slice does not own, each for one reason: `audit_events` (every storage and
 * configuration write is audited), `users` and `user_settings` (the profile
 * image), `system_settings` (the configuration view's `updatedAt`) and
 * `database_backup_runs` (the provider-switch gate).
 *
 * `forOrg` / `runInOrg` are optional: the reference app's `PrismaService`
 * has both, and a plain client gets core's helpers of the same name.
 *
 * @stability experimental
 */
export interface StoragePrisma extends StorageTx {
  /** `audit_events`; only `create` is called. */
  auditEvent: { create(args: StorageQueryArgs): Promise<unknown> };
  /** `users`; only `findUnique` is called. */
  user: { findUnique(args: StorageQueryArgs): Promise<any> };
  /** `user_settings`; only `findUnique` is called. */
  userSettings: { findUnique(args: StorageQueryArgs): Promise<any> };
  /** `system_settings`; only `findUnique` is called. */
  systemSettings: { findUnique(args: StorageQueryArgs): Promise<any> };
  /** `organizations`; only `findFirst` (the default organization) is called. */
  organization: { findFirst(args: StorageQueryArgs): Promise<any> };
  /** `database_backup_runs`; only `count` is called. */
  databaseBackupRun: { count(args?: StorageQueryArgs): Promise<number> };
  /** A tagged-template raw statement. */
  $executeRaw(query: TemplateStringsArray, ...values: unknown[]): Promise<number>;
  /** An interactive transaction. */
  $transaction<T>(fn: (tx: any) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
  /** A client extension. */
  $extends(extension: unknown): unknown;
  /** The app's own org-scoped client, when it has one (`PrismaService.forOrg`). */
  forOrg?(orgId: string, opts?: { userId?: string }): unknown;
  /** The app's own org-scoped transaction, when it has one (`PrismaService.runInOrg`). */
  runInOrg?<R>(orgId: string, fn: (tx: any) => Promise<R>, opts?: StorageRunInOrgOptions): Promise<R>;
}

/**
 * A client scoped to one organization: every operation runs with
 * `app.org_id` (and `app.user_id`) set, so another organization's objects are
 * neither visible nor writable. Uses the client's own `forOrg` when it has
 * one, core's `forOrg` otherwise.
 *
 * @param prisma - the `PLATFORM_PRISMA` client.
 * @param orgId - `principal.activeOrgId` or a job payload's `orgId`; never request input.
 * @param opts - `userId`, the acting user.
 * @returns the scoped client, seen as {@link StorageTx}.
 * @throws ScopedAccessError when an id is not a UUID (core's helper).
 *
 * @stability experimental
 */
export function storageForOrg(prisma: StoragePrisma, orgId: string, opts: { userId?: string } = {}): StorageTx {
  if (typeof prisma.forOrg === 'function') return prisma.forOrg(orgId, opts) as StorageTx;
  return forOrg(prisma as never, orgId, opts) as unknown as StorageTx;
}

/**
 * One interactive transaction in one organization's scope; `fn` receives the
 * plain transaction client. Uses the client's own `runInOrg` when it has one,
 * core's `runInOrg` otherwise.
 *
 * @typeParam R - what `fn` resolves to.
 * @param prisma - the `PLATFORM_PRISMA` client.
 * @param orgId - the organization.
 * @param fn - the unit of work.
 * @param opts - `userId` and Prisma's `maxWait` / `timeout`.
 * @returns what `fn` resolved to.
 *
 * @stability experimental
 */
export function storageRunInOrg<R>(
  prisma: StoragePrisma,
  orgId: string,
  fn: (tx: StorageTx & { [model: string]: any }) => Promise<R>,
  opts: StorageRunInOrgOptions = {},
): Promise<R> {
  if (typeof prisma.runInOrg === 'function') return prisma.runInOrg(orgId, fn, opts);
  const { userId, ...transaction } = opts;
  return runInOrg(
    prisma as never,
    { orgId, ...(userId !== undefined ? { userId } : {}) },
    fn as (tx: unknown) => Promise<R>,
    transaction,
  );
}
