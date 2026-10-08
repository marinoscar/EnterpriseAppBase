// =============================================================================
// The nodes slice's host ports (issue #734, PP-8.2)
// =============================================================================
//
// What the worker-node data plane needs from object storage, a slice it does
// NOT depend on (storage already depends on jobs for its handlers, so the
// reverse edge would be a cycle; and the data plane needs far less power than
// a storage provider has: least privilege). The app binds both tokens in a
// `@Global()` module (the reference app:
// `apps/api/src/platform/jobs/jobs-host.module.ts`).
//
// The tokens are `Symbol.for(...)` keys, so two copies of this file agree.
// =============================================================================

import type { Job } from '../jobs/index';

// ---- object store (the NODE_OBJECT_STORE seam) ----------------------------------------

/**
 * Injection token of the app's {@link NodeObjectStore}: how the data plane
 * mints the short-lived signed URLs a node moves job bytes through.
 *
 * @example
 * ```ts
 * // JobsHostModule: { provide: NODE_OBJECT_STORE, useExisting: STORAGE_PROVIDER }
 * ```
 *
 * @extensionPoint token
 * @stability experimental
 */
export const NODE_OBJECT_STORE: unique symbol = Symbol.for('@marinoscar/platform/nodes/OBJECT_STORE');

/**
 * Options of a signed GET, structurally the storage slice's `SignedUrlOptions`.
 *
 * @stability experimental
 */
export interface SignedUrlOptions {
  /** Lifetime in seconds. */
  expiresIn?: number;
  /** A `Content-Disposition` the response should carry. */
  responseContentDisposition?: string;
}

/**
 * Options of a signed PUT, structurally the storage slice's `SignedPutUrlOptions`.
 *
 * @stability experimental
 */
export interface SignedPutUrlOptions {
  /** Lifetime in seconds. */
  expiresIn?: number;
  /** The `Content-Type` the upload must send. */
  contentType?: string;
}

/**
 * The only storage capability the node data plane has: the two calls it
 * makes. Any object-storage provider with these two methods satisfies it (the
 * reference app binds its `STORAGE_PROVIDER`; `apps/api/src/platform/jobs/`
 * carries the compile-time proof).
 *
 * ⚠ A URL is a bearer capability: never log it.
 *
 * @stability experimental
 */
export interface NodeObjectStore {
  /**
   * A signed GET for `key`.
   *
   * @param key - the object key.
   * @param options - the URL's lifetime.
   */
  getSignedDownloadUrl(key: string, options?: SignedUrlOptions): Promise<string>;
  /**
   * A signed PUT for `key`.
   *
   * @param key - the object key the node writes.
   * @param options - the URL's lifetime and the upload's content type.
   */
  getSignedPutUrl(key: string, options?: SignedPutUrlOptions): Promise<string>;
}

// ---- job inputs (the NODE_JOB_INPUTS seam) ----------------------------------------------

/**
 * Injection token of the app's {@link NodeJobInputs}: which stored object a
 * held job reads.
 *
 * @extensionPoint token
 * @stability experimental
 */
export const NODE_JOB_INPUTS: unique symbol = Symbol.for('@marinoscar/platform/nodes/JOB_INPUTS');

/**
 * The stored object a job reads, as the data plane reports it to the node.
 *
 * @stability experimental
 */
export interface NodeJobInputObject {
  /** The object's id. */
  id: string;
  /** Its key in the object store. Never empty. */
  storageKey: string;
  /** Its size in bytes. */
  size: bigint;
  /** Its MIME type. */
  mimeType: string;
}

/**
 * Why a job's input could not be named. All three are permanent.
 *
 * @stability experimental
 */
export type NodeJobInputFailureReason = 'missing_subject_id' | 'input_object_not_found' | 'input_object_has_no_storage_key';

/**
 * A job whose input cannot be named: the data plane answers 422 with
 * `details.reason`, and the node reports the job failed.
 *
 * @stability experimental
 */
export class NodeJobInputError extends Error {
  /**
   * @param reason - which of the three ways it failed.
   * @param message - the operator-facing explanation.
   * @param jobId - the job.
   * @param subjectId - the subject it named, or `null`.
   */
  constructor(
    readonly reason: NodeJobInputFailureReason,
    message: string,
    readonly jobId: string,
    readonly subjectId: string | null,
  ) {
    super(message);
    this.name = 'NodeJobInputError';
  }
}

/**
 * The app's input resolution for node-held jobs: the job's organization, then
 * its subject object, in that organization's row-level-security scope.
 *
 * @stability experimental
 */
export interface NodeJobInputs {
  /**
   * The object `job` reads.
   *
   * @param job - a job the calling node holds (already checked).
   * @returns the object.
   * @throws NodeJobInputError when the job names no usable object.
   */
  resolve(job: Job): Promise<NodeJobInputObject>;
}
