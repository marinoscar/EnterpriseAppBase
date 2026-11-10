// =============================================================================
// `docs.scalar-cdn` — the API reference's CDN (#773)
// =============================================================================
//
// The reference app's catalog example of `EgressRegistry.register` from APP
// code (the Extension Contract, rung 2): `/api/docs` makes the BROWSER load the
// Scalar bundle from a CDN (and Scalar's fonts from fonts.scalar.com) unless
// `API_DOCS_CDN` points it elsewhere (the host slice's `renderDocsPage`). A fork adds its own
// outbound dependency the same way: an `@Injectable()` that injects
// `EgressRegistry`, registers itself in `onModuleInit`, and returns
// `egressDependency(...)` entries from a read-only `describe()`.
// =============================================================================

import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  EgressContributor,
  EgressDependency,
  EgressRegistry,
  egressDependency,
} from '@marinoscar/platform-api/doctor';

import { DEFAULT_SCALAR_CDN } from '@marinoscar/platform-api/host';

/** Where the default Scalar bundle loads its fonts from. */
export const SCALAR_FONTS_HOST = 'fonts.scalar.com';

/**
 * `docs.scalar-cdn`: the hosts the API reference page makes the browser load.
 * Never required: the API works without its reference page.
 *
 * Reads `API_DOCS_CDN` when `describe()` runs, exactly as `renderDocsPage`
 * does when it renders. A same-origin override (a path such as
 * `/scalar/api-reference.js`) is no outbound dependency at all, so the entry
 * is then disabled.
 */
@Injectable()
export class DocsEgressContributor implements EgressContributor, OnModuleInit {
  readonly id = 'docs';

  constructor(private readonly egress: EgressRegistry) {}

  onModuleInit(): void {
    this.egress.register(this);
  }

  async describe(): Promise<EgressDependency[]> {
    const override = process.env.API_DOCS_CDN?.trim() || '';
    const sameOrigin = override.startsWith('/') && !override.startsWith('//');
    const hosts = override ? [override] : [DEFAULT_SCALAR_CDN, SCALAR_FONTS_HOST];

    return [
      egressDependency({
        id: 'docs.scalar-cdn',
        capability: 'API reference (Scalar bundle)',
        direction: 'browser',
        enabled: !sameOrigin,
        required: false,
        hosts: sameOrigin ? [] : hosts,
        degradation: '/api/docs renders an empty page; the API itself and /api/openapi.json keep working',
      }),
    ];
  }
}
