import { z } from 'zod';

/**
 * completeUploadSchema.
 *
 * @stability experimental
 */
export const completeUploadSchema = z.object({
  parts: z.array(z.object({
    partNumber: z.number().int().positive(),
    eTag: z.string().min(1),
  })).min(1),
});

/**
 * CompleteUploadDto.
 *
 * @stability experimental
 */
export type CompleteUploadDto = z.infer<typeof completeUploadSchema>;

