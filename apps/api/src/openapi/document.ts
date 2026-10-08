// =============================================================================
// The reference app's OpenAPI document (issue #53; packaged by #867)
// =============================================================================
//
// The builder, the post-processing passes and the docs routes are the host
// slice's (`@marinoscar/platform-api/host`). What stays here is the app's
// binding: its identity (`APP_OPENAPI`) and its tag taxonomy (`./tags.ts`,
// registered into core's `openApiTags` on import). `main.ts`
// (`registerPlatformDocs`), `scripts/dump-openapi.ts` and the test suite all
// build the document through `createOpenApiDocument` below, so the document
// CI lints is the document users get.
// =============================================================================

import { APP_NAME, REPO_URL } from '@app/shared';
import type { INestApplication } from '@nestjs/common';
import type { OpenAPIObject } from '@nestjs/swagger';
import {
  createOpenApiDocument as createPlatformOpenApiDocument,
  type PlatformOpenApiOptions,
} from '@marinoscar/platform-api/host';

// Side effect: registers this app's tag taxonomy into `openApiTags` (issue #698).
import './tags';
import { resolveApiVersion } from './version';

// The builder's names, re-exported for the app's own document tests.
export { SECURITY_SCHEMES, buildOperationId, enrichOpenApiDocument, isAuthenticatedOperation } from '@marinoscar/platform-api/host';

/**
 * This app's identity in the document: `<APP_NAME> API`, the repository as the
 * contact and the `docs/` link, and the version resolved per build.
 */
export const APP_OPENAPI: PlatformOpenApiOptions = {
  appName: APP_NAME,
  repoUrl: REPO_URL,
  version: resolveApiVersion,
};

/**
 * Builds the finished document for this app. Call it after
 * `setGlobalPrefix('api')`.
 */
export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  return createPlatformOpenApiDocument(app, APP_OPENAPI);
}
