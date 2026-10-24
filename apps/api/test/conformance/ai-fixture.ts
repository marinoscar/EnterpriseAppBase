// =============================================================================
// How the reference app builds itself for the AI conformance suites (issue #742)
// =============================================================================
//
// The AI suites (kill switch, RBAC matrix, secret egress, key policy, jobs
// server-only) live in `@marinoscar/platform-api/ai/testing`; they cannot build
// this app. This object is the whole of what they ask of it, assembled from the
// helpers every other integration spec here uses: `createTestApp` (the full
// `AppModule` over a mocked Prisma client), `createMockTestUser`, the OpenAPI
// document builder, the seeded `ROLE_PERMISSIONS` and the default organization.
// An app that adopts the packages writes its own equivalent in a few lines.
// =============================================================================

import type { AiConformanceFixture } from '@marinoscar/platform-api/ai/testing';

import { ROLE_PERMISSIONS } from '../../prisma/seed-data';
import { createOpenApiDocument } from '../../src/openapi/document';
import { MOCK_DEFAULT_ORG_ID } from '../fixtures/test-data.factory';
import { createMockTestUser } from '../helpers/auth-mock.helper';
import { closeTestApp, createTestApp, type TestContext } from '../helpers/test-app.helper';
import { createAiHttpTestApp } from '../ai/ai-http.helper';

export const aiConformanceFixture: AiConformanceFixture = {
  createAiApp: (options) => createAiHttpTestApp(options),
  createContext: (options) => createTestApp({ useMockDatabase: true, overrideProviders: options?.overrideProviders }),
  closeContext: (context) => closeTestApp(context as TestContext),
  createUser: (context, options) =>
    createMockTestUser(context as TestContext, options as Parameters<typeof createMockTestUser>[1]),
  openApiDocument: (app) => createOpenApiDocument(app as never) as never,
  defaultOrgId: MOCK_DEFAULT_ORG_ID,
  rolePermissions: ROLE_PERMISSIONS,
};
