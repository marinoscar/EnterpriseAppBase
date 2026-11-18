// =============================================================================
// Protected resource metadata endpoints (PP-15.6, RFC 9728)
// =============================================================================
//
// Published at the root as `/.well-known/oauth-protected-resource[/<path>]` by
// the nginx fragment (and the Vite proxy in development); the API serves them
// under `/api/oauth/.well-known/protected-resource` because the API owns the
// `/api` prefix and the documents depend on runtime settings and registered
// resources (spec §2.8, epic amendment 1).
//
// `@Public()` ON PURPOSE: a client has no credential before it reads this.
// `Access-Control-Allow-Origin: *` without credentials: the document is public
// and takes no cookie, so the wildcard is safe (spec §3).
// =============================================================================

import { Controller, Get, Header, NotFoundException, Req, UseFilters } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyRequest } from 'fastify';

import { RawResponse } from '../../core/index';
import { Public } from '../auth/decorators/public.decorator';
import { requestPathOf } from '../auth/route-prefix';
import { buildProtectedResourceMetadata } from './oauth-resource-metadata';
import { oauthResourceRegistry, type OAuthProtectedResourceDefinition } from './oauth-resource.registry';
import { OAuthProtocolExceptionFilter } from './oauth-protocol.filter';
import { OAuthServerContext } from './oauth-server-context';
import { OAuthServerSettingsReader } from './oauth-server-settings.reader';

const WELL_KNOWN = '/api/oauth/.well-known/protected-resource';

/**
 * RFC 9728 protected resource metadata, one document per registered resource.
 *
 * @stability experimental
 */
@ApiTags('OAuth server')
@Controller('oauth')
@UseFilters(OAuthProtocolExceptionFilter)
export class OAuthResourceMetadataController {
  constructor(
    private readonly settings: OAuthServerSettingsReader,
    private readonly context: OAuthServerContext,
  ) {}

  private async requireEnabled(): Promise<void> {
    if (!(await this.settings.isEnabled())) throw new NotFoundException();
  }

  private document(resource: OAuthProtectedResourceDefinition) {
    return buildProtectedResourceMetadata({ issuer: this.context.issuer(), identifier: this.context.identifierOf(resource), resource });
  }

  // PUBLIC: RFC 9728 discovery, step two of the sign-in a client starts from a 401.
  /** `GET /api/oauth/.well-known/protected-resource`: the metadata of the only registered resource. */
  @Public()
  @Get('.well-known/protected-resource')
  @RawResponse()
  @Header('Cache-Control', 'public, max-age=300')
  @Header('Access-Control-Allow-Origin', '*')
  @ApiOperation({
    summary: 'Protected resource metadata (the only resource)',
    description:
      'The RFC 9728 document of the deployment\'s protected resource when exactly one is registered; `404` when none or several are (use the path form). ' +
      'Published at the root as `/.well-known/oauth-protected-resource`. `404` while the server is disabled.',
  })
  @ApiResponse({ status: 200, description: 'The metadata document (not enveloped).' })
  @ApiResponse({ status: 404, description: 'The OAuth server is not enabled, or not exactly one resource is registered.' })
  async only() {
    await this.requireEnabled();
    const resources = oauthResourceRegistry.list();
    if (resources.length !== 1) throw new NotFoundException();
    return this.document(resources[0]!);
  }

  // PUBLIC: as above, for the resource at `<path>` (for `/api/mcp`: `.../protected-resource/api/mcp`).
  /** `GET /api/oauth/.well-known/protected-resource/<path>`: the metadata of the resource at that path. */
  @Public()
  @Get('.well-known/protected-resource/*')
  @RawResponse()
  @Header('Cache-Control', 'public, max-age=300')
  @Header('Access-Control-Allow-Origin', '*')
  @ApiOperation({
    summary: 'Protected resource metadata for a resource path',
    description:
      'The RFC 9728 document of the resource whose `path` follows `/protected-resource` (for `/api/mcp`: `/api/oauth/.well-known/protected-resource/api/mcp`). ' +
      '`resource` is `APP_URL` + the path exactly; `authorization_servers` has one entry, the issuer. `404` for a path that matches no resource, and while the server is disabled.',
  })
  @ApiParam({ name: 'path', description: 'The resource path without its leading slash (for `/api/mcp`: `api/mcp`).' })
  @ApiResponse({ status: 200, description: 'The metadata document (not enveloped).' })
  @ApiResponse({ status: 404, description: 'The OAuth server is not enabled, or no resource has that path.' })
  async forPath(@Req() request: FastifyRequest) {
    await this.requireEnabled();
    const path = requestPathOf(request) ?? '';
    const rest = path.startsWith(`${WELL_KNOWN}/`) ? path.slice(WELL_KNOWN.length).replace(/\/+$/, '') : '';
    const resource = rest === '' ? undefined : oauthResourceRegistry.list().find((candidate) => candidate.path.replace(/\/+$/, '') === rest);
    if (!resource) throw new NotFoundException();
    return this.document(resource);
  }
}
