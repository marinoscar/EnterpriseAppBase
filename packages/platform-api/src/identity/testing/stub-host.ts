// =============================================================================
// In-memory host ports for booting the identity slice in a test (issue #727)
// =============================================================================
//
// `createStubIdentityHost()` returns a `@Global()` module that binds every
// identity host port (and core's `PLATFORM_PRISMA`, to the client you pass) to
// a recording in-memory stand-in, plus the state those stand-ins record, so a
// test boots `IdentityModule.forRoot({ imports: [host.module] })` with no app.
// Never use it in production code.
// =============================================================================

import { Global, Module, type DynamicModule, type Logger } from '@nestjs/common';

import { PLATFORM_PRISMA } from '../../core/index';
import type { AuthenticatedUser } from '../auth/interfaces/authenticated-user.interface';
import {
  IDENTITY_JOBS,
  IDENTITY_METRICS,
  IDENTITY_NODE_CREDENTIALS,
  IDENTITY_NOTIFIER,
  IDENTITY_PROFILE_IMAGES,
  USER_DEFAULTS,
  type IdentityJobHandler,
  type IdentityJobsPort,
  type IdentityMetrics,
  type IdentityNodeCredentials,
  type IdentityNotifier,
  type IdentityProfileImages,
  type UserDefaults,
} from '../ports';

/**
 * One recorded notifier call.
 *
 * @stability experimental
 */
export interface StubIdentityNotification {
  /** The notifier method called. */
  method: keyof IdentityNotifier;
  /** Its first argument: the user id or the address. */
  to: string;
  /** The notice. */
  notice: unknown;
}

/**
 * What {@link createStubIdentityHost} returns.
 *
 * @stability experimental
 */
export interface StubIdentityHost {
  /** The global module to pass in `IdentityModule.forRoot({ imports })`. */
  module: DynamicModule;
  /** What the stand-ins recorded. */
  state: StubIdentityHostState;
}

/**
 * What the stand-ins recorded.
 *
 * @stability experimental
 */
export interface StubIdentityHostState {
  /** Every notifier call, in order: the method and its arguments. */
  readonly notifications: StubIdentityNotification[];
  /** Every handler registered through `IDENTITY_JOBS`. */
  readonly handlers: IdentityJobHandler[];
  /** Every housekeeping job queued through `IDENTITY_JOBS`, by type. */
  readonly enqueued: string[];
  /** Every metric recorded: `authLogin:<outcome>`, `authRefresh:<outcome>` or the counter key. */
  readonly metrics: string[];
}

/**
 * Options of {@link createStubIdentityHost}.
 *
 * @stability experimental
 */
export interface StubIdentityHostOptions {
  /** The database client bound to `PLATFORM_PRISMA` (a mock, or a real client in a db test). */
  readonly prisma: unknown;
  /** The settings value a new user starts with; `{}` by default. */
  readonly userSettings?: Record<string, unknown>;
  /** Resolves a `nod_` token; every token is unknown by default. */
  readonly validateNodeToken?: (token: string) => Promise<AuthenticatedUser | null>;
}

/**
 * A global module binding identity's host ports to recording stand-ins.
 *
 * @param options - the database client and the optional overrides.
 * @returns the module to pass in `IdentityModule.forRoot({ imports })`, and what it records.
 *
 * @example
 * ```ts
 * const host = createStubIdentityHost({ prisma: prismaMock });
 * await Test.createTestingModule({
 *   imports: [ConfigModule.forRoot({ isGlobal: true, load: [() => identityConfiguration()] }),
 *             IdentityModule.forRoot({ imports: [host.module] })],
 * }).compile();
 * ```
 *
 * @stability experimental
 */
export function createStubIdentityHost(options: StubIdentityHostOptions): StubIdentityHost {
  const state: StubIdentityHostState = { notifications: [], handlers: [], enqueued: [], metrics: [] };
  const record = (method: keyof IdentityNotifier) => async (to: string, notice: unknown) => {
    state.notifications.push({ method, to, notice });
  };
  const notifier: IdentityNotifier = {
    roleChanged: record('roleChanged'),
    userWelcomed: record('userWelcomed'),
    allowlistInvitation: record('allowlistInvitation'),
    orgInvitation: record('orgInvitation'),
  };
  const userDefaults: UserDefaults = { userSettings: () => structuredClone(options.userSettings ?? {}) };
  const profileImages: IdentityProfileImages = {
    resolveImageUrl: (user) => user.providerProfileImageUrl ?? null,
    hasUploadedImage: () => false,
  };
  const jobs: IdentityJobsPort = {
    enqueueHousekeepingJob: async ({ type }: { type: string; what: string; logger: Logger }) => {
      state.enqueued.push(type);
    },
    registerHandler: (handler) => {
      state.handlers.push(handler);
    },
  };
  const metrics: IdentityMetrics = {
    authLogin: (outcome) => state.metrics.push(`authLogin:${outcome}`),
    authRefresh: (outcome) => state.metrics.push(`authRefresh:${outcome}`),
    add: (key) => state.metrics.push(key),
  };
  const nodes: IdentityNodeCredentials = { validateToken: options.validateNodeToken ?? (async () => null) };

  const providers = [
    { provide: PLATFORM_PRISMA, useValue: options.prisma },
    { provide: IDENTITY_NOTIFIER, useValue: notifier },
    { provide: USER_DEFAULTS, useValue: userDefaults },
    { provide: IDENTITY_PROFILE_IMAGES, useValue: profileImages },
    { provide: IDENTITY_JOBS, useValue: jobs },
    { provide: IDENTITY_METRICS, useValue: metrics },
    { provide: IDENTITY_NODE_CREDENTIALS, useValue: nodes },
  ];

  @Global()
  @Module({})
  class StubIdentityHostModule {}

  return {
    module: { module: StubIdentityHostModule, global: true, providers, exports: providers.map((provider) => provider.provide) },
    state,
  };
}
