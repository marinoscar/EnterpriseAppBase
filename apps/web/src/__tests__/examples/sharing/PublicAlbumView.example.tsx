/**
 * Example (issue #732): a link renderer and a branded public page.
 * Extension points: `registerLinkRenderer` (headless) and `PublicLinkPage`
 * with `slots.Frame` (ui) of `@marinoscar/platform-web/sharing`.
 *
 * The API side is apps/api/test/examples/sharing/public-album.controller.example.ts:
 * `GET /api/public/albums/current`, behind `LinkGrantGuard`, answers the album
 * a link opens with a presigned cover URL. This renderer calls it with the
 * token in the `x-link-token` header (never a URL), and shows the cover
 * through the presigned URL: an `<img src>` cannot send the header, so the
 * bytes never travel with the token.
 *
 * An app registers its renderers in one place before the first render,
 * then freezes the registry (the reference app: src/platform/linkRenderers.ts,
 * called from main.tsx). Proven by ./PublicAlbum.example.test.tsx.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { LINK_TOKEN_HEADER } from '@marinoscar/platform-contract/sharing';
import { registerLinkRenderer, type LinkRendererProps } from '@marinoscar/platform-web/sharing/headless';

/** What `GET /public/albums/current` answers. */
interface PublicAlbum {
  id: string;
  title: string;
  coverUrl: string;
}

/** The public view of an `example_album`. */
export function PublicAlbumView({ resolution, token, apiClient }: LinkRendererProps) {
  const [album, setAlbum] = useState<PublicAlbum | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    apiClient
      .get<PublicAlbum>('/public/albums/current', { headers: { [LINK_TOKEN_HEADER]: token } })
      .then((value) => live && setAlbum(value))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [apiClient, token]);

  if (failed) return <p>This album is not available.</p>;
  return (
    <article>
      <h1>{album?.title ?? resolution.title ?? 'Shared album'}</h1>
      {album ? <img src={album.coverUrl} alt={`Cover of ${album.title}`} referrerPolicy="no-referrer" /> : <p>Loading…</p>}
      {resolution.expiresAt ? <p>Available until {new Date(resolution.expiresAt).toLocaleDateString('en-US')}</p> : null}
    </article>
  );
}

/** The app's branding around every public link page (`PublicLinkPage.slots.Frame`). */
export function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div data-testid="public-frame">
      <header>Shared with you from Example Photos</header>
      <main>{children}</main>
    </div>
  );
}

/** The app's registration (in the reference app this line goes in `registerAppLinkRenderers`, before the freeze). */
export function registerExampleLinkRenderers(): void {
  registerLinkRenderer('example_album', PublicAlbumView);
}
