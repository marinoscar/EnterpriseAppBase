import { ApiProperty } from '@nestjs/swagger';
import type { TenancyMode } from '../../../core/index';

/**
 * Role information
 */
export class RoleDto {
  @ApiProperty({
    example: 'admin',
    description: 'Role name',
  })
  name!: string;
}

/**
 * The organization the session acts in (#724)
 */
export class ActiveOrgDto {
  @ApiProperty({ example: '0b6f1c2e-7a53-4a8e-9d0c-2f6a1e9b7c11', description: 'Organization ID', format: 'uuid' })
  id!: string;

  @ApiProperty({ example: 'Acme', description: 'Organization name' })
  name!: string;

  @ApiProperty({ example: 'acme', description: 'Organization slug' })
  slug!: string;
}

/**
 * One organization the user is an active member of (#724)
 */
export class OrgMembershipDto {
  @ApiProperty({ example: '0b6f1c2e-7a53-4a8e-9d0c-2f6a1e9b7c11', description: 'Organization ID', format: 'uuid' })
  orgId!: string;

  @ApiProperty({ example: 'Acme', description: 'Organization name' })
  name!: string;

  @ApiProperty({ example: 'acme', description: 'Organization slug' })
  slug!: string;

  @ApiProperty({ example: 'viewer', description: 'The org role on this membership (`org_admin`, `contributor` or `viewer`)' })
  role!: string;
}

/**
 * Current authenticated user information
 */
export class CurrentUserDto {
  @ApiProperty({
    example: '123e4567-e89b-12d3-a456-426614174000',
    description: 'User ID',
  })
  id!: string;

  @ApiProperty({
    example: 'user@example.com',
    description: 'User email address',
  })
  email!: string;

  // `type` is explicit because `string | null` erases to `Object` in the
  // emitted design-time metadata, so without it the property publishes as an
  // object — a client generator would produce the wrong type for the field.
  @ApiProperty({
    type: String,
    example: 'John Doe',
    description: 'Display name (computed from override or provider)',
    nullable: true,
  })
  displayName!: string | null;

  @ApiProperty({
    type: String,
    example: '/api/users/123e4567-e89b-12d3-a456-426614174000/avatar/0b6f1c2e-7a53-4a8e-9d0c-2f6a1e9b7c11',
    description:
      'The picture representing the user, resolved from `profile.imageSource`: null for ' +
      '`none`, the provider picture for `provider`, or the same-origin avatar path for ' +
      '`upload`. May be an absolute URL or a root-relative path.',
    nullable: true,
  })
  profileImageUrl!: string | null;

  @ApiProperty({
    type: String,
    example: 'https://lh3.googleusercontent.com/a/example',
    description: 'The OAuth provider picture, regardless of the selected source',
    nullable: true,
  })
  providerProfileImageUrl!: string | null;

  @ApiProperty({
    type: Boolean,
    example: true,
    description:
      'Whether an uploaded picture is stored (`profile.imageObjectId` is set), regardless of the ' +
      'selected source. Preview it with the authenticated `GET /api/user-settings/profile-image`.',
  })
  hasUploadedProfileImage!: boolean;

  @ApiProperty({
    example: true,
    description: 'Whether the user account is active',
  })
  isActive!: boolean;

  @ApiProperty({
    type: [RoleDto],
    description:
      'User roles: the system roles (`admin`) plus the role on the current organization membership (`org_admin`, `contributor` or `viewer`). A system administrator lists `admin` and `org_admin`.',
  })
  roles!: RoleDto[];

  @ApiProperty({
    type: [String],
    example: ['system_settings:read', 'users:write'],
    description:
      'Effective permissions: the grants of the system roles plus those of the current organization membership role',
  })
  permissions!: string[];

  @ApiProperty({
    enum: ['single', 'multi'],
    example: 'single',
    description:
      "The deployment's tenancy mode (`TENANCY_MODE`). `single`: everyone is in one " +
      'organization and organization management is hidden. `multi`: one organization per ' +
      'customer. A deployment-level fact, fixed until the API restarts.',
  })
  tenancyMode!: TenancyMode;

  @ApiProperty({
    type: ActiveOrgDto,
    nullable: true,
    description:
      "The organization this session acts in: the access token's `org` claim (or, for a personal " +
      'access token or device credential, the organization it is bound to). Roles and permissions ' +
      'above are computed for it. Change it with `POST /api/auth/switch-org`. Null only when the ' +
      'user has no active membership there.',
  })
  activeOrg!: ActiveOrgDto | null;

  @ApiProperty({
    type: [OrgMembershipDto],
    description: 'Every organization the user is an active member of, with the org role on each: the organizations `POST /api/auth/switch-org` accepts.',
  })
  memberships!: OrgMembershipDto[];
}

/**
 * JWT token response
 */
export class TokenResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...',
    description: 'JWT access token',
  })
  accessToken!: string;

  @ApiProperty({
    example: 900,
    description: 'Token expiration time in seconds',
  })
  expiresIn!: number;
}
