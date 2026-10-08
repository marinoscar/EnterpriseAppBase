// =============================================================================
// The data the credentials slice reads and writes, structurally (issue #735)
// =============================================================================
//
// The slice never imports a generated Prisma client, not even its types: a
// package is built, type-checked and tested before (and without) any app's
// `prisma generate`, and it must work with any app that composed the
// `credentials` fragment of `@marinoscar/platform-db`. Same rule as identity
// (`identity/data/identity-db.ts`) and sharing (`sharing/data/sharing-tx.ts`).
//
// The app hands its own client to the core port `PLATFORM_PRISMA`
// (`@marinoscar/platform-api/core`); Nest injection is untyped, so no cast is
// needed at the binding. The row types mirror the fragment's columns
// (`packages/platform-db/schema/credentials.prisma`).
// =============================================================================

/**
 * Prisma query arguments, as the slice builds them. The app's client checks
 * them at run time.
 *
 * @stability experimental
 */
export type CredentialsQueryArgs = Record<string, unknown>;

/**
 * One Prisma model delegate, as the credentials slice calls it. Every method
 * is generic in its result: a call that `select`s names the shape it reads.
 *
 * @typeParam Row - the full row type of the model.
 * @stability experimental
 */
export interface CredentialsDelegate<Row> {
  /** One row by a unique key, or `null`. */
  findUnique<T = Row>(args: CredentialsQueryArgs): Promise<T | null>;
  /** Every matching row. */
  findMany<T = Row>(args?: CredentialsQueryArgs): Promise<T[]>;
  /** Updates one row by a unique key. */
  update<T = Row>(args: CredentialsQueryArgs): Promise<T>;
  /** Inserts or updates one row by a unique key. */
  upsert<T = Row>(args: CredentialsQueryArgs): Promise<T>;
  /** Deletes every matching row. */
  deleteMany(args?: CredentialsQueryArgs): Promise<{ count: number }>;
}

/**
 * A `credentials` row: a deployment-owned secret.
 *
 * @stability experimental
 */
export interface CredentialRow {
  /** The row's id; never published. */
  id: string;
  /** The purpose (also the cipher's sub-key domain). */
  purpose: string;
  /** The discriminator within the purpose. */
  name: string;
  /** The `[iv][authTag][ciphertext]` payload, base64. */
  secret: string;
  /** The non-secret display hint, or `null`. */
  hint: string | null;
  /** The admin-entered label, or `null`. */
  label: string | null;
  /** Who last set it, or `null`. */
  updatedByUserId: string | null;
  /** When it was created. */
  createdAt: Date;
  /** When it last changed. */
  updatedAt: Date;
}

/**
 * A `user_credentials` row: a secret a user owns (bring your own key).
 *
 * @stability experimental
 */
export interface UserCredentialRow {
  /** The row's id; never published. */
  id: string;
  /** The owner. */
  userId: string;
  /** The purpose. */
  purpose: string;
  /** The discriminator within the purpose. */
  name: string;
  /** The ciphertext, under `user:<userId>:<purpose>`. */
  secret: string;
  /** The non-secret display hint, or `null`. */
  hint: string | null;
  /** The user-entered label, or `null`. */
  label: string | null;
  /** When it was created. */
  createdAt: Date;
  /** When it last changed. */
  updatedAt: Date;
}

/**
 * An `org_credentials` row: a secret an organization owns.
 *
 * @stability experimental
 */
export interface OrgCredentialRow {
  /** The row's id; never published. */
  id: string;
  /** The owning organization. */
  orgId: string;
  /** The purpose. */
  purpose: string;
  /** The discriminator within the purpose. */
  name: string;
  /** The ciphertext, under `org:<orgId>:<purpose>`. */
  secret: string;
  /** The non-secret display hint, or `null`. */
  hint: string | null;
  /** The admin-entered label, or `null`. */
  label: string | null;
  /** Who last set it, or `null`. */
  updatedByUserId: string | null;
  /** When it was created. */
  createdAt: Date;
  /** When it last changed. */
  updatedAt: Date;
}

/**
 * The app's Prisma client, as the credentials slice sees it through the core
 * `PLATFORM_PRISMA` port. `$extends` is how the user and org stores scope it
 * (`forUser` / `forOrg` from `@marinoscar/platform-api/core`).
 *
 * @stability experimental
 */
export interface CredentialsPrisma {
  /** `credentials`. */
  credential: CredentialsDelegate<CredentialRow>;
  /** `user_credentials`. */
  userCredential: CredentialsDelegate<UserCredentialRow>;
  /** `org_credentials`. */
  orgCredential: CredentialsDelegate<OrgCredentialRow>;
  /** Prisma's client-extension entry point. */
  $extends(extension: never): unknown;
  /** Prisma's batch and interactive transaction entry point. */
  $transaction(arg: never, options?: never): Promise<unknown>;
  /** Tagged-template raw statement. */
  $executeRaw(query: TemplateStringsArray, ...values: never[]): unknown;
}
