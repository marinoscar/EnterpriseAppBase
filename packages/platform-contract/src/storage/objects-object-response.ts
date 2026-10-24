import { z } from 'zod';
import { STORAGE_OBJECT_STATUSES, type StorageEnum } from './constants.js';

/**
 * Storage object metadata as returned to a caller.
 *
 * Declared as a zod schema rather than a bare TypeScript `interface` because an
 * interface is erased at compile time: `@ApiResponse({ type: ObjectResponseDto })`
 * against one produced nothing, and the controller fell back to `type: Object`,
 * publishing an empty schema. A `createZodDto` class is both the compile-time
 * type the service already used and a real JSON Schema in the document.
 *
 * @stability experimental
 */
export const objectResponseSchema = z.object({
  /** The id. */
  id: z.uuid(),
  /** The original filename. */
  name: z.string(),
  /** BigInt serialized as a string — 64-bit values lose precision as JSON numbers. */
  size: z.string(),
  /** The declared media type. */
  mimeType: z.string(),
  /** The status. */
  status: (z.enum(STORAGE_OBJECT_STATUSES) as z.ZodEnum<StorageEnum<typeof STORAGE_OBJECT_STATUSES>>),
  /** Free-form metadata, or `null`. */
  metadata: z.record(z.string(), z.unknown()).nullable(),
  /** When it was created (ISO). */
  createdAt: z.string(),
  /** When it was last written (ISO), or `null`. */
  updatedAt: z.string(),
});

/**
 * The `GET /api/storage/objects/:id/upload/status` payload: the parts uploaded so far.
 *
 * @stability experimental
 */
export const uploadStatusResponseSchema = z.object({
  /** The object id (UUID). */
  objectId: z.uuid(),
  /** The status. */
  status: (z.enum(STORAGE_OBJECT_STATUSES) as z.ZodEnum<StorageEnum<typeof STORAGE_OBJECT_STATUSES>>),
  /** Part numbers already uploaded, so a resuming client knows what to skip. */
  uploadedParts: z.array(z.number().int()),
  /** How many parts the upload has. */
  totalParts: z.number().int(),
  /** Bytes uploaded so far, as a string. */
  uploadedBytes: z.string(),
  /** The total size, as a string. */
  totalBytes: z.string(),
});


/**
 * One storage object as the API returns it.
 *
 * @stability stable
 */
export type ObjectResponse = z.infer<typeof objectResponseSchema>;

/**
 * A resumable upload's progress, as the API returns it.
 *
 * @stability stable
 */
export type UploadStatusResponse = z.infer<typeof uploadStatusResponseSchema>;
