// The two `@fastify/multipart` request methods the upload routes call, seen
// structurally (issue #736): the slice never imports the plugin (the app
// registers it in `main.ts`, with the simple-upload size cap), so the request
// is narrowed to what the plugin decorates it with.

import type { Readable } from 'node:stream';

/**
 * One file part of a multipart body, as `@fastify/multipart` hands it out.
 *
 * @internal
 *
 * @stability experimental
 */
export interface MultipartFilePart {
  /** The form field the file came in. */
  fieldname: string;
  /** The client's filename. */
  filename: string;
  /** The declared media type. */
  mimetype: string;
  /** The bytes, as a stream. */
  file: Readable;
  /** The bytes, buffered; rejects with `FST_REQ_FILE_TOO_LARGE` on a truncated file. */
  toBuffer(): Promise<Buffer>;
}

/**
 * A Fastify request decorated by `@fastify/multipart`.
 *
 * @internal
 *
 * @stability experimental
 */
export interface MultipartRequest {
  /** Whether the body is `multipart/form-data`. */
  isMultipart(): boolean;
  /** The first file part, or `undefined` when there is none. */
  file(options?: { limits?: { fileSize?: number; files?: number }; throwFileSizeLimit?: boolean }): Promise<MultipartFilePart | undefined>;
}

/**
 * The request, seen as {@link MultipartRequest}.
 *
 * @param req - the Fastify request of a route the app's multipart plugin serves.
 * @returns the same object.
 *
 * @internal
 *
 * @stability experimental
 */
export function asMultipart(req: unknown): MultipartRequest {
  return req as MultipartRequest;
}
