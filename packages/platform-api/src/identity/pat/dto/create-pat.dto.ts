import { createZodDto } from 'nestjs-zod';
import { createPatSchema } from '@marinoscar/platform-contract/identity';

// The schema is the contract's (#727).
export { createPatSchema };

export class CreatePatDto extends createZodDto(createPatSchema) {}
