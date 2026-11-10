import { z } from 'zod';

import type { StorageEnum } from './constants.js';

/**
 * The `POST /api/storage/objects/upload/init` body: the file name, size and media type.
 *
 * @stability experimental
 */
export const initUploadSchema = z.object({
  /** The original filename. */
  name: z.string().min(1).max(255),
  /** The size in bytes, as a string (64-bit safe). */
  size: z.number().int().positive(),
  /** The declared media type. */
  mimeType: z.string().min(1),
});

/**
 * The init-upload body, inferred.
 *
 * @stability experimental
 */
export type InitUploadDto = z.infer<typeof initUploadSchema>;

/**
 * How a client authenticates the PUT of one multipart part.
 *
 *  - `none`: the URL is a presigned provider URL (S3, R2). PUT the bytes with NO
 *    `Authorization` header.
 *  - `bearer`: the URL is this API's own part route
 *    (`PUT /api/storage/objects/:id/upload/parts/:partNumber`), served for a
 *    driver with no presigned URLs. PUT the raw bytes with the caller's
 *    `Authorization: Bearer` credential.
 *
 * @stability experimental
 */
export const PART_UPLOAD_AUTH_MODES = ['none', 'bearer'] as const;

/**
 * One of {@link PART_UPLOAD_AUTH_MODES}.
 *
 * @stability experimental
 */
export type PartUploadAuth = (typeof PART_UPLOAD_AUTH_MODES)[number];

/**
 * The most part URLs `init` returns; ask for more with `POST :id/upload/part-urls`.
 *
 * @stability experimental
 */
export const INIT_UPLOAD_PART_URL_BATCH = 10;

/**
 * The most part numbers one `POST :id/upload/part-urls` call may ask for.
 *
 * @stability experimental
 */
export const PART_URLS_MAX_PER_CALL = 100;

/**
 * One part and the URL to PUT it to: a presigned provider URL when the
 * upload's `partUploadAuth` is `none`, this API's part route (a same-origin
 * absolute URL, or a root-relative path when the deployment has no public
 * origin) when it is `bearer`.
 *
 * @stability experimental
 */
export const partUrlSchema = z.object({
  /** The part number (1-10000). */
  partNumber: z.number().int().positive(),
  /** Where to PUT the part; see `partUploadAuth` for the credential it needs. */
  url: z.string().min(1),
});

/**
 * The `POST /api/storage/objects/:id/upload/part-urls` body: the part numbers to mint URLs for (1 to 100).
 *
 * @stability experimental
 */
export const getPartUrlsSchema = z.object({
  /** The part numbers to mint URLs for. */
  partNumbers: z
    .array(z.number().int().min(1).max(10_000))
    .min(1)
    .max(PART_URLS_MAX_PER_CALL, `At most ${PART_URLS_MAX_PER_CALL} part URLs can be requested per call`),
});

/**
 * The part-urls body, inferred.
 *
 * @stability experimental
 */
export type GetPartUrlsDto = z.infer<typeof getPartUrlsSchema>;

/**
 * The `POST /api/storage/objects/:id/upload/part-urls` payload: the URLs and how to authenticate the PUT to them.
 *
 * @stability experimental
 */
export const getPartUrlsResponseSchema = z.object({
  /** One URL per requested part, in the order asked. */
  presignedUrls: z.array(partUrlSchema),
  /** How to authenticate the PUT to each URL. */
  partUploadAuth: (z.enum(PART_UPLOAD_AUTH_MODES) as z.ZodEnum<StorageEnum<typeof PART_UPLOAD_AUTH_MODES>>),
});

/**
 * The part-urls payload, inferred.
 *
 * @stability experimental
 */
export type GetPartUrlsResponse = z.infer<typeof getPartUrlsResponseSchema>;

/**
 * The `details.reason` values the multipart routes answer with. The envelope's
 * `code` follows the HTTP status; a client keys its recovery on the reason:
 *
 *  - `UPLOAD_NOT_ACTIVE` (400): the object is not an upload in progress.
 *  - `PART_OUT_OF_RANGE` (400): the part number is outside `1..totalParts`.
 *  - `PART_SIZE_MISMATCH` (400): the body is not the exact size the part must be.
 *  - `RAW_BODY_REQUIRED` (415): the part was not sent as raw bytes (the app did not call `registerStoragePartBodyParser`, or the content type was JSON/text).
 *  - `PRESIGNED_PARTS_REQUIRED` (400): this upload's driver takes presigned URLs, not API parts.
 *  - `UPLOAD_PARTS_MISSING` (409): `complete` found parts the backend does not hold (`details.partNumbers`: re-send those, then complete again).
 *  - `UPLOAD_SESSION_INVALID` (409): the backend no longer knows the multipart session; abort and re-initialise.
 *
 * @stability experimental
 */
export const UPLOAD_ERROR_REASONS = {
  /** The object is not an upload in progress (400). */
  UPLOAD_NOT_ACTIVE: 'UPLOAD_NOT_ACTIVE',
  /** The part number is outside 1..totalParts (400). */
  PART_OUT_OF_RANGE: 'PART_OUT_OF_RANGE',
  /** The body is not the exact size the part must be (400). */
  PART_SIZE_MISMATCH: 'PART_SIZE_MISMATCH',
  /** The upload takes presigned URLs, not API parts (400). */
  PRESIGNED_PARTS_REQUIRED: 'PRESIGNED_PARTS_REQUIRED',
  /** The part was not sent as raw bytes (415). */
  RAW_BODY_REQUIRED: 'RAW_BODY_REQUIRED',
  /** complete found parts the backend does not hold (409). */
  UPLOAD_PARTS_MISSING: 'UPLOAD_PARTS_MISSING',
  /** The backend lost the multipart session (409). */
  UPLOAD_SESSION_INVALID: 'UPLOAD_SESSION_INVALID',
} as const;

/**
 * One of the {@link UPLOAD_ERROR_REASONS} values.
 *
 * @stability experimental
 */
export type UploadErrorReason = (typeof UPLOAD_ERROR_REASONS)[keyof typeof UPLOAD_ERROR_REASONS];

/**
 * The init-upload payload: the object id, the provider upload id, the part size, how to upload a part and the first part URLs (at most 10).
 *
 * @stability experimental
 */
export const initUploadResponseSchema = z.object({
  /** The object id (UUID). */
  objectId: z.uuid(),
  /** Provider-side multipart upload id, echoed back on complete/abort. */
  uploadId: z.string(),
  /** Byte length of every part but the last. */
  partSize: z.number().int().positive(),
  /** How many parts the upload has. */
  totalParts: z.number().int().positive(),
  /** The first part URLs (at most 10). Upload to them, then call complete; ask for more at `upload/part-urls`. */
  presignedUrls: z.array(partUrlSchema),
  /** How to authenticate the PUT to each URL: `none` (presigned) or `bearer` (this API's part route). */
  partUploadAuth: (z.enum(PART_UPLOAD_AUTH_MODES) as z.ZodEnum<StorageEnum<typeof PART_UPLOAD_AUTH_MODES>>),
});


/**
 * The `POST /api/storage/objects/upload/init` payload.
 *
 * @stability stable
 */
export type InitUploadResponse = z.infer<typeof initUploadResponseSchema>;
