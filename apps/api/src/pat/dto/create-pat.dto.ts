import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const createPatSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100, 'Name must be 100 characters or less'),
  durationValue: z
    .number()
    .int('Duration value must be an integer')
    .min(1, 'Duration value must be at least 1')
    .max(999, 'Duration value must be at most 999'),
  durationUnit: z.enum(['minutes', 'days', 'months'], {
    error: 'Duration unit must be one of: minutes, days, months',
  }),
  // #724: the organization the token acts in, for its whole life. Must be an
  // active membership of the caller (else 400); defaults to the caller's
  // active organization.
  orgId: z
    .uuid('orgId must be a UUID')
    .optional()
    .describe(
      "The organization the token is bound to. Must be one you are an active member of; defaults to the caller's active organization.",
    ),
});

export class CreatePatDto extends createZodDto(createPatSchema) {}
