import { z } from 'zod';

export const updateMetadataSchema = z.object({
  metadata: z.record(z.unknown()),
});

export type UpdateMetadataDto = z.infer<typeof updateMetadataSchema>;
