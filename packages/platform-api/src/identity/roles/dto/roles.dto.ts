import { createZodDto } from 'nestjs-zod';
import { roleDescriptorSchema, roleListQuerySchema } from '@marinoscar/platform-contract/identity';

// The schemas are the contract's; the DTOs wrap them so the OpenAPI document is generated from them.

export class RoleListQueryDto extends createZodDto(roleListQuerySchema) {}

export class RoleDescriptorDto extends createZodDto(roleDescriptorSchema) {}
