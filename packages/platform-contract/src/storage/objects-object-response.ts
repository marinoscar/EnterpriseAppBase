import { z } from 'zod';
import { STORAGE_OBJECT_STATUSES } from './constants.js';

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
  id: z.uuid(),
  name: z.string(),
  /** BigInt serialized as a string — 64-bit values lose precision as JSON numbers. */
  size: z.string(),
  mimeType: z.string(),
  status: z.enum(STORAGE_OBJECT_STATUSES),
  metadata: z.record(z.string(), z.unknown()).nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

/**
 * uploadStatusResponseSchema.
 *
 * @stability experimental
 */
export const uploadStatusResponseSchema = z.object({
  objectId: z.uuid(),
  status: z.enum(STORAGE_OBJECT_STATUSES),
  /** Part numbers already uploaded, so a resuming client knows what to skip. */
  uploadedParts: z.array(z.number().int()),
  totalParts: z.number().int(),
  uploadedBytes: z.string(),
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
