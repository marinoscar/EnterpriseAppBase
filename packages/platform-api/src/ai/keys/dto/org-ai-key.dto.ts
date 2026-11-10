import { orgAiKeyViewSchema, setOrgAiKeySchema } from '@marinoscar/platform-contract/ai';
import { createZodDto } from 'nestjs-zod';

/** `PUT /api/admin/ai/org-keys/:provider` body (#739). Write-only. */
export class SetOrgAiKeyDto extends createZodDto(setOrgAiKeySchema) {}

/** One provider's organization key, masked (#739). */
export class OrgAiKeyViewDto extends createZodDto(orgAiKeyViewSchema) {}
