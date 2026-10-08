import { z } from 'zod';

/**
 * updateMetadataSchema.
 *
 * @stability experimental
 */
export const updateMetadataSchema = z.object({
  /** Merged into the object's existing metadata rather than replacing it. */
  metadata: z.record(z.string(), z.unknown()),
});

/**
 * UpdateMetadataDto.
 *
 * @stability experimental
 */
export type UpdateMetadataDto = z.infer<typeof updateMetadataSchema>;

