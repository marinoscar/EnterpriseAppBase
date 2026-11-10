import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Principal } from '../../core/index';

import { Auth } from '../auth/decorators/auth.decorator';
import { CurrentPrincipal } from '../auth/decorators/current-principal.decorator';
import { ApiDataResponse } from '../../core/index';
import { PERMISSIONS } from '../identity.constants';
import { OrganizationsAdminService } from './organizations-admin.service';
import {
  CreateOrganizationDto,
  OrganizationListQueryDto,
  OrganizationResponseDto,
  RenameOrganizationDto,
} from './dto/organization.dto';

/**
 * The deployment's organizations (#726, PP-6.7), for a deployment operator.
 * SYSTEM permissions (`organizations:read` / `organizations:write`, held by
 * the system `admin` role); the settings card `Organizations`
 * (`/admin/settings/organizations`) declares exactly `organizations:read`.
 */
@ApiTags('Organizations')
@Controller('admin/organizations')
export class OrganizationsAdminController {
  constructor(private readonly organizations: OrganizationsAdminService) {}

  @Get()
  @Auth({ permissions: [PERMISSIONS.ORGANIZATIONS_READ] })
  @ApiOperation({
    summary: 'List organizations',
    description: 'Every organization of the deployment, the default one first, with its active member count.',
  })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'pageSize', required: false, type: Number })
  @ApiQuery({ name: 'search', required: false, type: String })
  @ApiDataResponse(OrganizationResponseDto, { pagination: 'flat', description: 'Paginated organizations' })
  async list(@Query() query: OrganizationListQueryDto) {
    return this.organizations.list(query);
  }

  @Post()
  @Auth({ permissions: [PERMISSIONS.ORGANIZATIONS_WRITE] })
  @ApiOperation({
    summary: 'Create an organization',
    description:
      'Creates an organization and a pending `org_admin` invitation for `firstAdminEmail` (added to the ' +
      'allowlist and emailed after the write commits). Refused with 409 (`details.reason: TENANCY_SINGLE_ORG`) ' +
      'in single-organization mode, and with 409 (`details.reason: SLUG_TAKEN`) for a slug in use. Writes the ' +
      '`org:created` and `org:invite_created` audit events.',
  })
  @ApiDataResponse(OrganizationResponseDto, { status: 201, description: 'The new organization' })
  @ApiResponse({ status: 409, description: 'Single-organization mode, or the slug is taken' })
  async create(@Body() dto: CreateOrganizationDto, @CurrentPrincipal() principal: Principal) {
    return this.organizations.create(principal.userId, dto);
  }

  @Patch(':id')
  @Auth({ permissions: [PERMISSIONS.ORGANIZATIONS_WRITE] })
  @ApiOperation({
    summary: 'Rename an organization',
    description:
      'Changes the name only: the slug is immutable through this API, and which organization is the default ' +
      'cannot be changed. Writes the `org:renamed` audit event.',
  })
  @ApiParam({ name: 'id', type: String, format: 'uuid' })
  @ApiDataResponse(OrganizationResponseDto, { description: 'The renamed organization' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async rename(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RenameOrganizationDto,
    @CurrentPrincipal() principal: Principal,
  ) {
    return this.organizations.rename(principal.userId, id, dto);
  }
}
