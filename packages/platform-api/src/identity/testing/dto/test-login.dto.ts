import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { roleIdSchema } from '@marinoscar/platform-contract/identity';

// `role` is any role the application registered (checked by the service against
// the role catalog); the schema checks only its shape.
const testLoginSchema = z.object({
  email: z.string().email(),
  role: roleIdSchema.optional().default('viewer'),
  displayName: z.string().optional(),
});

export class TestLoginDto extends createZodDto(testLoginSchema) {}
