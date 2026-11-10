/**
 * The app's link renderers: how the public `/s` page shows each resource type
 * a link share can point at (issue #731, PP-7.4).
 *
 * `@marinoscar/platform-web/sharing`'s `PublicLinkPage` renders the component
 * registered here for the resolved resource type, and the neutral "This link
 * is not available" for any type without one. Register each renderer with
 * `registerLinkRenderer(resourceType, Component)` inside
 * `registerAppLinkRenderers`, BEFORE the freeze; the component receives
 * `{ resolution, token, apiClient }` and calls the app's public routes with
 * the token in the `x-link-token` header, never in a URL.
 *
 * The template registers no renderer (it ships no shareable resource type),
 * so every link it resolves shows the neutral message. A worked renderer, for
 * an example album type, is
 * `src/__tests__/examples/sharing/PublicAlbumView.example.tsx` (issue #732).
 *
 * Called once, from `main.tsx`, before the first render: a renderer
 * registered later (a lazily imported module, say) throws `FROZEN` instead of
 * quietly adding or replacing the view of a public page.
 */

import { freezeLinkRenderers } from '@marinoscar/platform-web/sharing/headless';

/** Registers this app's link renderers, then freezes the registry. */
export function registerAppLinkRenderers(): void {
  freezeLinkRenderers();
}
