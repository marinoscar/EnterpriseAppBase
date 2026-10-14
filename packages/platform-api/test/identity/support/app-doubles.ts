// =============================================================================
// Stand-ins for the reference app's services, for the identity specs (#727)
// =============================================================================
//
// The identity specs moved here from apps/api with the code they test. Where a
// spec named an app service, it now names the host port the slice injects
// instead; each export below is BOTH the port's injection token (a value, for
// `{ provide: X, useValue }` and `module.get(X)`) and its type, under the app
// service's old name, so the specs read as they did.
// =============================================================================

import {
  IDENTITY_EVENT_BUS,
  IDENTITY_METRICS,
  IDENTITY_NODE_CREDENTIALS,
  IDENTITY_NOTIFIER,
  IDENTITY_PROFILE_IMAGES,
  NOOP_IDENTITY_METRICS,
  USER_DEFAULTS,
  type IdentityEventBus,
  type IdentityEventBusHealth,
  type IdentityEventBusMeta,
  type IdentityMetrics,
  type IdentityNodeCredentials,
  type IdentityNotifier,
  type IdentityPrisma,
  type IdentityProfileImages,
  type UserDefaults,
} from '../../../src/identity/index';
import { LocalIdentityEventBus } from '../../../src/identity/auth/principal-cache/local-event-bus';
import { PLATFORM_PRISMA } from '../../../src/core/index';

/** The database port (the app's `PrismaService`). */
export const PrismaService = PLATFORM_PRISMA;
export type PrismaService = IdentityPrisma;

/** The notifier port (the app binds its `NotificationsService`). */
export const NotificationsService = IDENTITY_NOTIFIER;
export type NotificationsService = IdentityNotifier;

/** The metrics port (the app binds its `AppMetricsService`). */
export const AppMetricsService = IDENTITY_METRICS;
export type AppMetricsService = IdentityMetrics;

/** The metrics a graph without the app's instruments gets: no-ops. */
export function fallbackAppMetrics(): IdentityMetrics {
  return NOOP_IDENTITY_METRICS;
}

/** The node-credential port (the app binds its `NodeCredentialService`). */
export const NodeCredentialService = IDENTITY_NODE_CREDENTIALS;
export type NodeCredentialService = IdentityNodeCredentials;

/** The event-bus port (the app binds its `EVENT_BUS`). */
export const EVENT_BUS = IDENTITY_EVENT_BUS;
export type EventBus = IdentityEventBus;
export type EventBusHealth = IdentityEventBusHealth;
export type EventBusMeta = IdentityEventBusMeta;
/** A single-process bus (the app's in-process adapter's semantics). */
export const InProcessEventBus = LocalIdentityEventBus;

/** The settings value the specs' new users start with (the app's `DEFAULT_USER_SETTINGS`). */
export const DEFAULT_USER_SETTINGS = {
  theme: 'system',
  profile: { imageSource: 'provider', imageObjectId: null },
} as const;

/** `USER_DEFAULTS` for the specs. */
export const testUserDefaults: UserDefaults = {
  userSettings: () => structuredClone(DEFAULT_USER_SETTINGS) as unknown as Record<string, unknown>,
};

/** `IDENTITY_PROFILE_IMAGES` for the specs: the app's #367 rule, reduced to what they exercise. */
export const testProfileImages: IdentityProfileImages = {
  resolveImageUrl(user, storedProfile) {
    const profile = (storedProfile ?? {}) as { imageSource?: string; imageObjectId?: string | null; useProviderImage?: boolean };
    const source = profile.imageSource ?? (profile.useProviderImage === false ? 'none' : 'provider');
    if (source === 'none') return null;
    if (source === 'upload') return profile.imageObjectId ? `/api/users/${user.id}/avatar/${profile.imageObjectId}` : null;
    return user.providerProfileImageUrl ?? null;
  },
  hasUploadedImage(storedProfile) {
    const id = (storedProfile as { imageObjectId?: unknown } | null | undefined)?.imageObjectId;
    return typeof id === 'string' && id !== '';
  },
};

/** The two required user ports, as test-module providers. */
export const identityUserPorts = [
  { provide: USER_DEFAULTS, useValue: testUserDefaults },
  { provide: IDENTITY_PROFILE_IMAGES, useValue: testProfileImages },
];

/**
 * An {@link IdentityNotifier} over a `notify` / `notifyAddress` mock, with the
 * reference app's event keys, so a spec that asserted the dispatcher calls
 * keeps asserting them.
 */
export function notifierFromNotify(mock: {
  notify?: (eventKey: string, userId: string, data: unknown) => unknown;
  notifyAddress?: (eventKey: string, email: string, data: unknown) => unknown;
}): IdentityNotifier {
  return {
    roleChanged: async (userId, notice) => {
      await mock.notify?.('security.role_changed', userId, notice);
    },
    userWelcomed: async (userId, notice) => {
      await mock.notify?.('user.welcome', userId, notice);
    },
    allowlistInvitation: async (email, notice) => {
      await mock.notifyAddress?.('allowlist.invitation', email, notice);
    },
    orgInvitation: async (email, notice) => {
      await mock.notifyAddress?.('org.invitation', email, notice);
    },
  };
}

/**
 * A spec's `notify` / `notifyAddress` mock, provided under this token, and
 * {@link notifierProvider} turning it into the `IDENTITY_NOTIFIER` the slice
 * injects: the specs keep asserting the dispatcher calls they always did.
 */
export const NOTIFY_MOCK = Symbol('NOTIFY_MOCK');

/** `IDENTITY_NOTIFIER` over the spec's {@link NOTIFY_MOCK}. */
export const notifierProvider = {
  provide: IDENTITY_NOTIFIER,
  useFactory: (mock: Parameters<typeof notifierFromNotify>[0]) => notifierFromNotify(mock),
  inject: [NOTIFY_MOCK],
};
