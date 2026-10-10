// =============================================================================
// What the AI conformance suites need from the app (issue #742)
// =============================================================================
//
// The kill switch, the RBAC matrix, secret egress, key policy and jobs
// server-only boot the app and drive it over HTTP. A package cannot build the
// app (it imports no `apps/**`, and it must not depend on `@nestjs/testing`, a
// peer the app owns), so the app hands the suites ONE object describing how it
// is built. The suites own every assertion; the fixture owns the wiring:
//
//   - `createAiApp`   the app with the AI runtime replaced by the harness
//                     (`createAiRuntimeHarness`: the real `AiService`, runs and
//                     config over `FakeAiProvider` and in-memory tables), over
//                     a mocked Prisma client, listening on an ephemeral port;
//   - `createContext` the same app WITHOUT the harness, optionally with provider
//                     overrides (the admin surface's credential stores);
//   - `createUser`    a principal with an access token for a role;
//   - `openApiDocument` the OpenAPI document of a booted app (routes and their
//                     `x-rbac` metadata are DISCOVERED from it, never listed);
//   - the default organization's id and the seeded role grants.
//
// The reference app implements it in `apps/api/test/conformance/ai-fixture.ts`
// from its own helpers (`createTestApp`, `createMockTestUser`, `ROLE_PERMISSIONS`).
// =============================================================================

import type { AiRuntimeHarness, AiRuntimeHarnessOptions } from '../ai-runtime-harness';
import type { FakeAiScript } from '../fake-ai-provider';
import { HARNESS_ORG_KEY, HARNESS_TENANT_KEY, HARNESS_USER_KEY } from '../ai-runtime-harness';

/**
 * A booted Nest application, as far as the suites use it: `get` for providers,
 * `getHttpServer` for supertest. Structural, so the package needs no Nest app type.
 *
 * @stability experimental
 */
export interface AiConformanceNestApp {
  /** Resolves a provider from the container. */
  get<T = unknown>(token: unknown): T;
  /** The HTTP server supertest drives. */
  getHttpServer(): any;
}

/**
 * A booted app plus the mocked Prisma client behind it. `prismaMock` is a
 * deep `jest.fn` mock (`prismaMock.userAiKey.findMany.mockResolvedValue(...)`):
 * the suites that need a row the harness does not provide stub it directly.
 *
 * @stability experimental
 */
export interface AiConformanceContext {
  /** The booted application. */
  app: AiConformanceNestApp;
  /** The mocked Prisma client the app runs on. */
  prismaMock: any;
}

/**
 * The app with the AI harness wired in. Exactly what the reference app's
 * `createAiHttpTestApp` returns.
 *
 * @stability experimental
 */
export interface AiConformanceApp {
  /** The booted app and its mocked database. */
  context: AiConformanceContext;
  /** The wired AI runtime: the fake provider and every recorded call, row and job. */
  harness: AiRuntimeHarness;
  /** `http://127.0.0.1:<port>` of the listening app. */
  baseUrl: string;
  /** Replaces the fake provider's script for the next calls. */
  script(next: FakeAiScript | undefined): void;
  /** Delays (ms) the fake before each streamed event. */
  setDelay(ms: number): void;
  /** Restores a clean runtime, and re-seeds the mocked users, between tests. */
  reset(): void;
  /** Closes the app. */
  close(): Promise<void>;
}

/**
 * A principal the suites authenticate as.
 *
 * @stability experimental
 */
export interface AiConformanceUser {
  /** The user id. */
  id: string;
  /** A bearer token the app accepts for that user. */
  accessToken: string;
}

/**
 * The OpenAPI document of a booted app, as far as the suites read it.
 *
 * @stability experimental
 */
export interface AiConformanceOpenApiDocument {
  /** Path items by path (`/api/ai/config`), each holding one operation per HTTP method. */
  paths?: Record<string, unknown>;
}

/**
 * How the app builds itself for the AI conformance suites. See the header of
 * this file; the reference implementation is `apps/api/test/conformance/ai-fixture.ts`.
 *
 * @example
 * ```ts
 * const fixture: AiConformanceFixture = {
 *   createAiApp: (options) => createAiHttpTestApp(options),
 *   createContext: (options) => createTestApp({ useMockDatabase: true, ...options }),
 *   closeContext: (context) => closeTestApp(context),
 *   createUser: (context, options) => createMockTestUser(context, options),
 *   openApiDocument: (app) => createOpenApiDocument(app),
 *   defaultOrgId: MOCK_DEFAULT_ORG_ID,
 *   rolePermissions: ROLE_PERMISSIONS,
 * };
 * ```
 *
 * @extensionPoint option
 * @stability experimental
 */
export interface AiConformanceFixture {
  /** Boots the app with the AI harness wired in, over a mocked database. */
  createAiApp(options?: AiRuntimeHarnessOptions): Promise<AiConformanceApp>;
  /** Boots the app WITHOUT the AI harness, with the given providers replaced. */
  createContext(options?: {
    /** Provider substitutions, one entry per provider. */
    overrideProviders?: Array<{ provide: unknown; useValue: unknown }>;
  }): Promise<AiConformanceContext>;
  /** Closes a context made by `createContext`. */
  closeContext(context: AiConformanceContext): Promise<void>;
  /** Registers a user with `roleName` (and optionally a fixed `id`) and returns a token for it. */
  createUser(context: AiConformanceContext, options: { id?: string; roleName: string }): Promise<AiConformanceUser>;
  /** The OpenAPI document of `app` (routes, with the `x-rbac` metadata `@Auth()` stamps). */
  openApiDocument(app: AiConformanceNestApp): AiConformanceOpenApiDocument;
  /** The id of the organization the minted users belong to. */
  defaultOrgId: string;
  /** Permissions granted per role (`admin`, `contributor`, `viewer`), exactly as the app seeds them. */
  rolePermissions: Readonly<Record<string, readonly string[]>>;
}

/**
 * The distinct key of a second user, which must never appear anywhere.
 *
 * @stability experimental
 */
export const OTHER_USER_KEY = 'sk-other-user-key-never-leak-4242';

/**
 * Every key a response or frame must never contain.
 *
 * @stability experimental
 */
export const ALL_KEYS: readonly string[] = [HARNESS_USER_KEY, HARNESS_ORG_KEY, HARNESS_TENANT_KEY, OTHER_USER_KEY];

/**
 * One parsed SSE frame. Comment lines (`: ping`) are kept as `{ comment }`.
 *
 * @stability experimental
 */
export interface ParsedFrame {
  /** The `event:` name. */
  event?: string;
  /** The parsed JSON of the `data:` lines. */
  data?: any;
  /** The text of a `: comment` line. */
  comment?: string;
}

/**
 * Parses a complete `text/event-stream` body.
 *
 * @param body - the whole response text.
 * @returns one frame per blank-line-separated block.
 *
 * @stability experimental
 */
export function parseSse(body: string): ParsedFrame[] {
  const frames: ParsedFrame[] = [];

  for (const block of body.split('\n\n')) {
    if (!block.trim()) continue;

    const frame: ParsedFrame = {};
    const data: string[] = [];

    for (const line of block.split('\n')) {
      if (line.startsWith(':')) frame.comment = line.slice(1).trim();
      else if (line.startsWith('event:')) frame.event = line.slice(6).trim();
      else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
    }

    if (data.length > 0) frame.data = JSON.parse(data.join('\n'));
    frames.push(frame);
  }

  return frames;
}

/**
 * Replaces each path parameter (`{provider}`, `{id}`) with `test-value`: the guards run before any pipe reads it.
 *
 * @param path - an OpenAPI path.
 * @returns the path with every parameter filled in.
 *
 * @stability experimental
 */
export function concreteRoutePath(path: string): string {
  return path.replace(/\{[^}]+\}/g, 'test-value');
}

/** The HTTP methods an OpenAPI path item may carry, in spec order. */
const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;

/**
 * Visits every operation of a document, skipping the `parameters` and `servers`
 * siblings of the methods on a path item.
 *
 * @param document - an OpenAPI document.
 * @param visit - called with the operation, its path and its lower-case method.
 *
 * @stability experimental
 */
export function forEachDocumentOperation(
  document: AiConformanceOpenApiDocument,
  visit: (operation: Record<string, unknown>, path: string, method: string) => void,
): void {
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;
    for (const method of HTTP_METHODS) {
      const operation = (pathItem as Record<string, unknown>)[method];
      if (operation && typeof operation === 'object') visit(operation as Record<string, unknown>, path, method);
    }
  }
}

/**
 * An `Authorization` header.
 *
 * @stability experimental
 */
export interface AiAuthorizationHeader {
  /** `Bearer <token>`. */
  Authorization: string;
  /** Any other header supertest accepts. */
  [header: string]: string;
}

/**
 * The `Authorization` header for a bearer token.
 *
 * @param token - an access token from {@link AiConformanceFixture.createUser}.
 *
 * @stability experimental
 */
export function authHeader(token: string): AiAuthorizationHeader {
  return { Authorization: `Bearer ${token}` };
}
