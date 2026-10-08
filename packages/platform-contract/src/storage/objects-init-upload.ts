import { z } from 'zod';

/**
 * initUploadSchema.
 *
 * @stability experimental
 */
export const initUploadSchema = z.object({
  name: z.string().min(1).max(255),
  size: z.number().int().positive(),
  mimeType: z.string().min(1),
});

/**
 * InitUploadDto.
 *
 * @stability experimental
 */
export type InitUploadDto = z.infer<typeof initUploadSchema>;

/**
 * initUploadResponseSchema.
 *
 * @stability experimental
 */
export const initUploadResponseSchema = z.object({
  objectId: z.uuid(),
  /** Provider-side multipart upload id, echoed back on complete/abort. */
  uploadId: z.string(),
  /** Byte length of every part but the last. */
  partSize: z.number().int().positive(),
  totalParts: z.number().int().positive(),
  /** One signed PUT URL per part. Upload to them directly, then call complete. */
  presignedUrls: z.array(
    z.object({
      partNumber: z.number().int().positive(),
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
