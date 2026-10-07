import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * `POST /api/auth/switch-org` body (#724): the organization to act in next.
 * The ONLY place an org id enters the auth path from request input, and it is
 * checked against the caller's active memberships before anything is issued;
 * the org of every other request comes from the signed token.
 */
export const switchOrgSchema = z.object({
  orgId: z.uuid('orgId must be a UUID').describe('The organization to switch to (an active membership of the caller).'),
});

export class SwitchOrgDto extends createZodDto(switchOrgSchema) {}
