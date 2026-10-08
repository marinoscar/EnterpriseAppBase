// =============================================================================
// The link-renderer registry (issue #731, PP-7.4): rung 2 of the Extension
// Contract for the public `/s` page
// =============================================================================
//
// A link share resolves to `{ resourceType, resourceId, role, ... }`; the
// platform knows nothing about how a `media_item` or a `transcript` looks to
// an anonymous visitor. The app registers ONE component per resource type, at
// startup, and freezes the registry once it has bootstrapped; `PublicLinkPage`
// renders the registered component for the resolved type, or the neutral
// "This link is not available" when there is none.
//
// The core registry semantics (`@marinoscar/platform-api/core`'s `Registry`):
// string ids checked against a pattern, a duplicate id is an error, and after
// `freeze()` a registration is an error while reads keep working. Errors carry
// a `code` to switch on, never the message.
// =============================================================================

import { SHARING_IDENTIFIER_PATTERN } from '@marinoscar/platform-contract/sharing';
import type { PublicLinkResolution } from '@marinoscar/platform-contract/sharing';
import type { ComponentType } from 'react';

import type { PlatformApiClient } from '../../core/index.js';

/**
 * What a registered link renderer receives.
 *
 * @stability experimental
 */
export interface LinkRendererProps {
  /** What the token resolved to: the record, the role, the expiry, the title. */
  resolution: PublicLinkResolution;
  /**
   * The link token, in memory only. Send it in the `x-link-token` header
   * (`LINK_TOKEN_HEADER`) to the app's public routes; never put it in a URL,
   * storage or a log line.
   */
  token: string;
  /** The app's transport; pass `{ headers: { [LINK_TOKEN_HEADER]: token } }` on each call. */
  apiClient: PlatformApiClient;
}

/**
 * A component that renders one resource type's public view.
 *
 * @stability experimental
 */
export type LinkRenderer = ComponentType<LinkRendererProps>;

/**
 * Why a link-renderer registration was refused.
 *
 * @stability experimental
 */
export type LinkRendererRegistryErrorCode = 'INVALID_ID' | 'DUPLICATE_ID' | 'FROZEN';

/**
 * A refused registration. Switch on `code`, never on the message.
 *
 * @stability experimental
 */
export class LinkRendererRegistryError extends Error {
  /** Why. */
  readonly code: LinkRendererRegistryErrorCode;
  /** The resource type id the registration named. */
  readonly id: string;

  /**
   * @param code - why the registration was refused.
   * @param id - the resource type id.
   * @param message - the human-readable reason.
   */
  constructor(code: LinkRendererRegistryErrorCode, id: string, message: string) {
    super(message);
    this.name = 'LinkRendererRegistryError';
    this.code = code;
    this.id = id;
  }
}

/**
 * The resource type to component map behind {@link registerLinkRenderer}.
 * The app uses the default instance through the module functions; a test may
 * build its own and pass it to `PublicLinkPage`.
 *
 * @stability experimental
 */
export class LinkRendererRegistry {
  private readonly entries = new Map<string, LinkRenderer>();
  private frozen = false;

  /**
   * Registers the renderer of one resource type.
   *
   * @param resourceType - a registered resource type id (lower-case snake_case).
   * @param component - the renderer.
   * @throws LinkRendererRegistryError `INVALID_ID`, `DUPLICATE_ID` or `FROZEN`.
   */
  register(resourceType: string, component: LinkRenderer): void {
    if (this.frozen) {
      throw new LinkRendererRegistryError(
        'FROZEN',
        resourceType,
        `Link renderers are frozen: register "${resourceType}" at startup, before freezeLinkRenderers().`,
      );
    }
    if (typeof resourceType !== 'string' || resourceType.length > 64 || !SHARING_IDENTIFIER_PATTERN.test(resourceType)) {
      throw new LinkRendererRegistryError('INVALID_ID', String(resourceType), `"${String(resourceType)}" is not a resource type id (lower-case snake_case).`);
    }
    if (this.entries.has(resourceType)) {
      throw new LinkRendererRegistryError('DUPLICATE_ID', resourceType, `A link renderer for "${resourceType}" is already registered.`);
    }
    this.entries.set(resourceType, component);
  }

  /**
   * The renderer of a resource type.
   *
   * @param resourceType - the resolved resource type.
   * @returns the renderer, or `undefined` when none is registered.
   */
  get(resourceType: string): LinkRenderer | undefined {
    return this.entries.get(resourceType);
  }

  /**
   * The registered resource types, in registration order.
   *
   * @returns a fresh array.
   */
  types(): string[] {
    return [...this.entries.keys()];
  }

  /** Refuses every later registration. Idempotent; reads keep working. */
  freeze(): void {
    this.frozen = true;
  }

  /**
   * Whether {@link LinkRendererRegistry.freeze} ran.
   *
   * @returns `true` once frozen.
   */
  isFrozen(): boolean {
    return this.frozen;
  }
}

/**
 * The app's link renderers: the instance the module functions and
 * `PublicLinkPage` use by default.
 *
 * @stability experimental
 */
export const linkRenderers: LinkRendererRegistry = new LinkRendererRegistry();

/**
 * Registers how the public `/s` page shows one resource type. Call it at
 * startup, before {@link freezeLinkRenderers}.
 *
 * @param resourceType - the resource type id, as registered on the API (`media_item`).
 * @param component - receives `{ resolution, token, apiClient }`.
 * @throws LinkRendererRegistryError `INVALID_ID`, `DUPLICATE_ID` or `FROZEN`.
 *
 * @example
 * ```tsx
 * registerLinkRenderer('media_item', PublicMediaView);
 * freezeLinkRenderers();
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function registerLinkRenderer(resourceType: string, component: LinkRenderer): void {
  linkRenderers.register(resourceType, component);
}

/**
 * Freezes the app's link renderers: call it once the app has bootstrapped, so
 * a late import cannot add or swap the renderer of a public page.
 *
 * @example
 * ```ts
 * // apps/web/src/main.tsx, after every registration
 * freezeLinkRenderers();
 * ```
 *
 * @extensionPoint registry
 * @stability experimental
 */
export function freezeLinkRenderers(): void {
  linkRenderers.freeze();
}
