import { createZodDto } from 'nestjs-zod';
import { deviceTokenRequestSchema } from '@marinoscar/platform-contract/identity';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Request DTO for polling device authorization status
 */
// The schema is the contract's (#727).
export const DeviceTokenRequestSchema = deviceTokenRequestSchema;

export class DeviceTokenRequestDto extends createZodDto(DeviceTokenRequestSchema) {
  @ApiProperty({
    description:
      'Device verification code returned by `POST /auth/device/code` (the `deviceCode` ' +
      'field). Opaque; not the human-readable user code.',
    example: 'a4f3b8c9d2e1f5a6b7c8d9e0f1a2b3c4',
  })
  deviceCode!: string;
}
