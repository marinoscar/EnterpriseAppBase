// =============================================================================
// The data the android-app slice reads and writes, structurally (issue #746)
// =============================================================================
//
// The slice never imports a generated Prisma client (the package rule): the
// client arrives through the core port `PLATFORM_PRISMA` and is seen as
// {@link AndroidAppPrisma}. Delegate arguments are untyped on purpose, so an
// app's generated client is assignable as it is. The row mirrors the
// `android-app` fragment of `@marinoscar/platform-db` column for column.
// =============================================================================

/**
 * Prisma's arguments for one delegate call, untyped on purpose (the app's
 * client checks them at run time).
 *
 * @stability experimental
 */
export type AndroidAppQueryArgs = any;

/**
 * An `android_app_releases` row.
 *
 * @stability experimental
 */
export interface AndroidAppReleaseRow {
  /** Primary key. */
  id: string;
  /** The application id inside the APK. */
  packageName: string;
  /** The human version. */
  versionName: string;
  /** The build number. */
  versionCode: number;
  /** The signing certificate fingerprint (upper-case colon pairs). */
  signingSha256: string;
  /** SHA-256 of the APK bytes, 64 lower-case hex digits. */
  fileSha256: string;
  /** The APK size. BigInt: returned as a decimal string. */
  sizeBytes: bigint;
  /** The object key, under `android-releases/`. */
  storageKey: string;
  /** The storage provider the bytes were written to, or null. */
  storageProvider: string | null;
  /** The bucket the bytes were written to, or null. */
  bucket: string | null;
  /** Release notes, or null. */
  notes: string | null;
  /** Whether users are offered it (at most one row: the raw-SQL index). */
  isCurrent: boolean;
  /** The uploader, or null once that account is gone. */
  uploadedById: string | null;
  /** Upload time. */
  createdAt: Date;
}

/**
 * What a batch write (`updateMany`, `deleteMany`) returns.
 *
 * @stability experimental
 */
export interface AndroidAppBatchResult {
  /** Rows affected. */
  count: number;
}

/**
 * One delegate of the composed client, as the slice calls it.
 *
 * @stability experimental
 */
export interface AndroidAppDelegate<Row> {
  /** Prisma `findUnique`. */
  findUnique(args: AndroidAppQueryArgs): Promise<Row | null>;
  /** Prisma `findFirst`. */
  findFirst(args?: AndroidAppQueryArgs): Promise<Row | null>;
  /** Prisma `findMany`. */
  findMany(args?: AndroidAppQueryArgs): Promise<Row[]>;
  /** Prisma `create`. */
  create(args: AndroidAppQueryArgs): Promise<Row>;
  /** Prisma `update`. */
  update(args: AndroidAppQueryArgs): Promise<Row>;
  /** Prisma `updateMany`. */
  updateMany(args: AndroidAppQueryArgs): Promise<AndroidAppBatchResult>;
  /** Prisma `deleteMany`. */
  deleteMany(args?: AndroidAppQueryArgs): Promise<AndroidAppBatchResult>;
  /** Prisma `count`. */
  count(args?: AndroidAppQueryArgs): Promise<number>;
  /** Prisma `groupBy`. */
  groupBy(args: AndroidAppQueryArgs): Promise<Array<{ [field: string]: any }>>;
}

/**
 * The client inside a transaction.
 *
 * @stability experimental
 */
export interface AndroidAppTx {
  /** `android_app_releases`. */
  androidAppRelease: AndroidAppDelegate<AndroidAppReleaseRow>;
  /** `users` (identity fragment): the uploader and the download link's user. */
  user: AndroidAppDelegate<any>;
  /** `push_subscriptions` (notifications fragment): the counts and the test notification. */
  pushSubscription: AndroidAppDelegate<any>;
}

/**
 * The client the slice injects under `PLATFORM_PRISMA`.
 *
 * @stability experimental
 */
export interface AndroidAppPrisma extends AndroidAppTx {
  /** Prisma's interactive transaction. */
  $transaction<T>(fn: (tx: AndroidAppTx) => Promise<T>, options?: { maxWait?: number; timeout?: number }): Promise<T>;
}

/**
 * Whether `error` is Prisma's unique violation (`P2002`), optionally on one
 * named index. Structural (no generated client): reads `code`, the driver
 * adapter's `meta.driverAdapterError.cause` (Prisma 7 with an adapter), then
 * `meta.target`, then the message.
 *
 * @param error - anything thrown by a Prisma call.
 * @param indexName - the index or constraint to match; omitted, any P2002.
 * @returns true when it is that violation.
 *
 * @stability experimental
 */
export function isUniqueViolation(error: unknown, indexName?: string): boolean {
  const candidate = error as { code?: unknown; meta?: Record<string, unknown>; message?: unknown } | null;
  if (!candidate || candidate.code !== 'P2002') return false;
  if (indexName === undefined) return true;
  const meta = candidate.meta ?? {};
  const cause = (meta.driverAdapterError as { cause?: Record<string, unknown> } | undefined)?.cause;
  if (cause) {
    const constraint = cause.constraint as { index?: unknown } | undefined;
    if (constraint?.index === indexName) return true;
    if (typeof cause.originalMessage === 'string' && cause.originalMessage.includes(indexName)) return true;
  }
  const target = meta.target;
  if (typeof target === 'string' && target === indexName) return true;
  if (Array.isArray(target) && target.some((entry) => String(entry) === indexName)) return true;
  return typeof candidate.message === 'string' && candidate.message.includes(indexName);
}
