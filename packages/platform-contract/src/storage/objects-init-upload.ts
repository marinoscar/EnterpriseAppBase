import { z } from 'zod';

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
 * The init-upload payload: the object id, the provider upload id, the part size and the first presigned part URLs.
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
  /** One signed PUT URL per part. Upload to them directly, then call complete. */
  presignedUrls: z.array(
    z.object({
      /** The part number (1-10000). */
      partNumber: z.number().int().positive(),
      /** The signed URL; fetch it directly. */
      url: z.url(),
    }),
  ),
});


/**
 * The `POST /api/storage/objects/upload/init` payload.
 *
 * @stability stable
 */
export type InitUploadResponse = z.infer<typeof initUploadResponseSchema>;
