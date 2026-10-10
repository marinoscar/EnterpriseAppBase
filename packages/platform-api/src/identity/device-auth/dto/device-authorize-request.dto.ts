import { createZodDto } from 'nestjs-zod';
import { deviceAuthorizeRequestSchema } from '@marinoscar/platform-contract/identity';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Request DTO for authorizing a device
 */
// The schema is the contract's (#727).
export const DeviceAuthorizeRequestSchema = deviceAuthorizeRequestSchema;

export class DeviceAuthorizeRequestDto extends createZodDto(DeviceAuthorizeRequestSchema) {
  @ApiProperty({
    description: 'User verification code to authorize',
    example: 'ABCD-1234',
    pattern: '^[A-Z0-9]{4}-[A-Z0-9]{4}$',
  })
  userCode!: string;

  @ApiProperty({
    description: 'Whether to approve or deny the device',
    example: true,
  })
  approve!: boolean;
}
