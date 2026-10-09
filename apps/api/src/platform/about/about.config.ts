// =============================================================================
// The reference app's binding of the about module (issue #891)
// =============================================================================
//
// `GET /api/admin/about` is the host slice's (`@marinoscar/platform-api/host`).
// The one fact it cannot find for itself is this app's own version, so the app
// hands it `resolveApiVersion` (`../../openapi/version.ts`).
//
// `app.module.ts` places `aboutModule` where the route has always been in the
// generated OpenAPI document (module order).
// =============================================================================

import { AboutModule } from '@marinoscar/platform-api/host';

import { resolveApiVersion } from '../../openapi/version';

export const aboutModule = AboutModule.forRoot({ apiVersion: resolveApiVersion });
