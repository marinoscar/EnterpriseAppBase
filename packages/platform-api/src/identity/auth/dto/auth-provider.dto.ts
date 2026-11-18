import { ApiProperty } from '@nestjs/swagger';

/**
 * OAuth provider information
 */
export class AuthProviderDto {
  @ApiProperty({
    example: 'google',
    description: 'OAuth provider name',
  })
  name!: string;

  @ApiProperty({
    example: true,
    description: 'Whether the provider is enabled',
  })
  enabled!: boolean;

  @ApiProperty({
    required: false,
    enum: ['custom'],
    example: 'custom',
    description:
      'Present only for a provider that owns its sign-in flow (no `/api/auth/<name>` redirect route): the login page then asks the web provider look to start it. Absent for a redirect provider.',
  })
  mode?: 'custom';
}

/**
 * Response for listing enabled OAuth providers
 */
export class AuthProvidersResponseDto {
  @ApiProperty({
    type: [AuthProviderDto],
    description: 'List of OAuth providers',
  })
  providers!: AuthProviderDto[];
}
