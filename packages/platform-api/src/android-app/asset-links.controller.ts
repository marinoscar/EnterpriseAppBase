import { Controller, Get, Logger, Res } from '@nestjs/common';
import { ApiOperation, ApiProduces, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { FastifyReply } from 'fastify';
import { ASSET_LINKS_CACHE_CONTROL } from '@marinoscar/platform-contract/android-app';

import { AllowDuringMaintenance } from '../core/index';
import { Public } from '../identity/index';
import { AndroidAppService } from './android-app.service';

// =============================================================================
//   GET /api/well-known/assetlinks.json   PUBLIC, deliberately
//
// Chrome (deciding whether a Trusted Web Activity may hide its URL bar) and
// Google's Digital Asset Links verifier fetch `/.well-known/assetlinks.json`
// unauthenticated, so this route is `@Public()` and reachable during a
// maintenance window. It is read-only and serves only what the trusted list
// already makes public (package names and certificate fingerprints, which
// every installed APK discloses). The edge proxy maps the well-known path
// here (`@marinoscar/platform-infra` nginx snippet `android-assetlinks.conf`).
// The body is a bare JSON array, not the `{ data }` envelope: the verifier
// requires exactly that shape.
// =============================================================================

/**
 * The public Digital Asset Links statement list.
 *
 * @stability experimental
 */
@ApiTags('Android App')
@Controller('well-known')
@AllowDuringMaintenance()
export class AssetLinksController {
  private readonly logger = new Logger(AssetLinksController.name);

  constructor(private readonly androidApp: AndroidAppService) {}

  /**
   * Serves the statements, bare.
   *
   * @param reply - the Fastify reply (bypasses the envelope interceptor).
   */
  @Get('assetlinks.json')
  @Public()
  @ApiOperation({
    summary: 'Digital Asset Links statement list (public)',
    description:
      'Served at `/.well-known/assetlinks.json` by the edge proxy. A bare JSON array (no `{ data }` envelope) with one ' +
      'statement per trusted Android package: `{ "relation": ["delegate_permission/common.handle_all_urls"], ' +
      '"target": { "namespace": "android_app", "package_name": "<package>", "sha256_cert_fingerprints": ["AA:BB:..."] } }`. ' +
      '`[]` when no app is trusted. `Cache-Control: public, max-age=300`. Deliberately public (Chrome and the ' +
      'verifier fetch it unauthenticated) and reachable during a maintenance window.',
  })
  @ApiProduces('application/json')
  @ApiResponse({ status: 200, description: 'The statement list (a bare JSON array)' })
  async getAssetLinks(@Res() reply: FastifyReply): Promise<void> {
    const statements = await this.androidApp.getAssetLinks();
    this.logger.debug(`assetlinks.json served (${statements.length} statement(s))`);
    await reply
      .status(200)
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Cache-Control', ASSET_LINKS_CACHE_CONTROL)
      .send(JSON.stringify(statements));
  }
}
