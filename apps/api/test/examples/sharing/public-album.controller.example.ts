// =============================================================================
// Example: a public route served by a share link (issue #730 pattern, #732)
// =============================================================================
//
// Extension points: `LinkGrantGuard`, `@LinkGrantResource`, `@CurrentLinkGrant`
// and `LinkGrantsService.withLinkScope` (rung 5: the public-route pattern).
//
// MemoriaHub's `public-share.controller.ts`, rebuilt on the slice. The
// recipient opens `<APP_URL>/s#lnk_...`; the SPA reads the token from the URL
// fragment and calls this route with it in the `X-Link-Token` header (never
// a path or a query string, which would reach the access log).
//
//   @Public()                 the app's marker: deliberately public, the guard
//                             authenticates (the identity and sharing
//                             conformance suites both read it)
//   @UseGuards(LinkGrantGuard) resolves the token, or the ONE 404 for every
//                             failure (429 past the per-address miss budget),
//                             and sets `Cache-Control: no-store` and
//                             `Referrer-Policy: no-referrer`
//   @LinkGrantResource        which links the route accepts: albums, with a
//                             role that reaches the `read` action
//   withLinkScope             every read in ONE transaction scoped to the
//                             link's organization with no user: RLS applies
//
// FILE BYTES ARE NEVER STREAMED WITH THE TOKEN: an `<img src>` cannot send the
// header, so the route returns a short-lived PRESIGNED download URL minted by
// the app's storage provider (here the `ALBUM_MEDIA_URLS` port; in the
// reference app, the storage provider's presigned GET). Proven by
// ./group-owned-resource.example.db.spec.ts.
// =============================================================================

import { Controller, Get, Inject, UseGuards } from '@nestjs/common';
import { Public } from '@marinoscar/platform-api/identity';
import { CurrentLinkGrant, LinkGrantGuard, LinkGrantResource, LinkGrantsService, type ResolvedLinkGrant } from '@marinoscar/platform-api/sharing';
import type { Prisma } from '@prisma/client';

import { ALBUM_TYPE } from './group-owned-resource.example';

/** Mints a short-lived download URL for an object-storage key (the app's storage provider). */
export interface AlbumMediaUrls {
  presignedGetUrl(key: string, ttlSeconds: number): Promise<string>;
}
export const ALBUM_MEDIA_URLS = Symbol('ALBUM_MEDIA_URLS');

/** How long a public cover URL lives. */
export const PUBLIC_COVER_URL_TTL_SECONDS = 300;

/** What an anonymous visitor sees of an album. */
export interface PublicAlbumView {
  id: string;
  title: string;
  role: string;
  expiresAt: string | null;
  coverUrl: string;
}

@Controller('public/albums')
@Public()
@UseGuards(LinkGrantGuard)
export class PublicAlbumController {
  constructor(
    @Inject(LinkGrantsService) private readonly links: LinkGrantsService,
    @Inject(ALBUM_MEDIA_URLS) private readonly media: AlbumMediaUrls,
  ) {}

  /** `GET /public/albums/current` with `X-Link-Token`: the album the link opens. */
  @Get('current')
  @LinkGrantResource(ALBUM_TYPE, { action: 'read' })
  async current(@CurrentLinkGrant() link: ResolvedLinkGrant): Promise<PublicAlbumView> {
    const [album] = await this.links.withLinkScope(link, (tx) =>
      (tx as Prisma.TransactionClient).$queryRaw<Array<{ title: string; cover_key: string }>>`
        SELECT title, cover_key FROM sharing_test_albums WHERE id = ${link.resourceId}::uuid`,
    );
    // The guard already checked the record exists in the link's organization.
    return {
      id: link.resourceId,
      title: album!.title,
      role: link.role,
      expiresAt: link.expiresAt ? link.expiresAt.toISOString() : null,
      coverUrl: await this.media.presignedGetUrl(album!.cover_key, PUBLIC_COVER_URL_TTL_SECONDS),
    };
  }
}
