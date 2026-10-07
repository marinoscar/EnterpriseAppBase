import { createZodDto } from 'nestjs-zod';
import { switchOrgSchema } from '@marinoscar/platform-contract/identity';

// The schema is the contract's (#727).
export { switchOrgSchema };

export class SwitchOrgDto extends createZodDto(switchOrgSchema) {}
