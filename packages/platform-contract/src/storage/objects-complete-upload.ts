import { z } from 'zod';

/**
 * The `POST /api/storage/objects/:id/upload/complete` body: every uploaded part with its ETag.
 *
 * @stability experimental
 */
export const completeUploadSchema = z.object({
  /** Every uploaded part, with its ETag. */
  parts: z.array(z.object({
    /** The part number (1-10000). */
    partNumber: z.number().int().positive(),
    /** The part's ETag, as the provider returned it. */
    eTag: z.string().min(1),
  })).min(1),
});

/**
 * The complete-upload body, inferred.
 *
 * @stability experimental
 */
export type CompleteUploadDto = z.infer<typeof completeUploadSchema>;

