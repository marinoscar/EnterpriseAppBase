import { createZodDto } from 'nestjs-zod';
import type { z } from 'zod';
import {
  deviceClientInfoSchema,
  deviceCodeRequestSchema,
  deviceTokenTypeSchema,
} from '@marinoscar/platform-contract/identity';
import { ApiProperty } from '@nestjs/swagger';

// The schemas are the contract's (#727): `@marinoscar/platform-contract/identity`
// documents why `tokenType` defaults to `session` and why every client-info
// field is hostile input.
export const DeviceTokenTypeSchema = deviceTokenTypeSchema;

export type DeviceTokenType = z.infer<typeof DeviceTokenTypeSchema>;

export const ClientInfoSchema = deviceClientInfoSchema;

/**
 * Request DTO for initiating device authorization flow
 */
export const DeviceCodeRequestSchema = deviceCodeRequestSchema;

export class DeviceCodeRequestDto extends createZodDto(DeviceCodeRequestSchema) {
  @ApiProperty({
    description:
      'Optional client information. `tokenType` selects the credential this flow will mint ' +
      'when the device polls `POST /auth/device/token` after the user approves (it is minted ' +
      'on the poll, not at approval): `session` (default) returns a short-lived JWT plus a ' +
      'refresh token, `pat` returns a long-lived, revocable personal access token for CLI ' +
      'use, tagged `credentialType: "pat"` in the poll response. An unrecognised `tokenType` ' +
      'is rejected with a 400. `deviceName` is echoed to the approving user on the activation ' +
      'page and, for `pat`, becomes the token name in the Access Tokens list.',
    required: false,
  })
  // Typed as the schema's OUTPUT rather than re-declared by hand: after
  // `.default('session')` zod guarantees `tokenType` is populated once parsed,
  // and a hand-written `tokenType?:` would contradict the generated base class.
  // Deriving it also means the two can never drift apart again.
  clientInfo?: z.infer<typeof ClientInfoSchema>;
}
