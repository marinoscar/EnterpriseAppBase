import { PLATFORM_PRISMA } from '@marinoscar/platform-api/core';
import {
  IDENTITY_EVENT_BUS,
  IDENTITY_NODE_CREDENTIALS,
  IDENTITY_NOTIFIER,
  IDENTITY_PROFILE_IMAGES,
  USER_DEFAULTS,
} from '@marinoscar/platform-api/identity';

import { EVENT_BUS } from '../../src/common/event-bus/event-bus.interface';
import { NodeCredentialService } from '@marinoscar/platform-api/nodes';
import { NotificationsIdentityNotifier } from '../../src/platform/identity/identity-notifier.adapter';
import { AppProfileImages, AppUserDefaults } from '../../src/platform/identity/identity-user.adapters';
import { PrismaService } from '../../src/prisma/prisma.service';

// =============================================================================
// The identity slice's host ports, for an app spec that builds a small graph
// =============================================================================
//
// A spec that provides identity services (AuthService, UsersService, the guards)
// in its own test module, instead of booting `AppModule`, adds these: each port
// is bound to the reference app's real adapter (./src/platform/identity/), over
// whatever `PrismaService`, `NotificationsService` and `NodeCredentialService`
// the spec provides. `IdentityHostModule` binds the same in the app (#727).
// =============================================================================

/** The database, notifier and user ports, over the spec's own providers. */
export const IDENTITY_APP_PORTS = [
  { provide: PLATFORM_PRISMA, useExisting: PrismaService },
  { provide: IDENTITY_NOTIFIER, useClass: NotificationsIdentityNotifier },
  { provide: USER_DEFAULTS, useClass: AppUserDefaults },
  { provide: IDENTITY_PROFILE_IMAGES, useClass: AppProfileImages },
];

/** `JwtAuthGuard`'s node-credential port, over the spec's `NodeCredentialService`. */
export const IDENTITY_GUARD_PORTS = [{ provide: IDENTITY_NODE_CREDENTIALS, useExisting: NodeCredentialService }];

/** The principal cache's bus port, over the spec's `EVENT_BUS`. */
export const IDENTITY_BUS_PORTS = [{ provide: IDENTITY_EVENT_BUS, useExisting: EVENT_BUS }];
