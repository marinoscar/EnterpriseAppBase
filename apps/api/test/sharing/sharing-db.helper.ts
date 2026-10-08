// =============================================================================
// The REAL sharing services over a row-level-security database (issue #728)
// =============================================================================
//
// Builds the sharing slice's services exactly as the app wires them (the app's
// `SharingDataAdapter` over `PrismaService` and `PrismaSystemService`), on a
// throwaway database owned by an ordinary role (`createRlsDatabase`), so every
// answer about isolation comes from Postgres. The bus, the emitter and the
// notifier are recording doubles.
//
// NOT A `*.spec.ts` FILE, so Jest never runs it as a suite.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { Module } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import { definePlatformHost, type Principal } from '@marinoscar/platform-api/core';
import {
  AccessPolicy,
  GrantsPruneHandler,
  GrantsService,
  GroupInvitesService,
  GroupMembershipService,
  GroupsService,
  PrincipalGroupsProvider,
  SHARING_DATA,
  SHARING_EVENT_EMITTER,
  SHARING_NOTIFIER,
  SHARING_TENANCY,
  SharingModule,
  type SharingDataPort,
} from '@marinoscar/platform-api/sharing';

import { SharingDataAdapter } from '../../src/platform/sharing/sharing-data.adapter';
import { rlsServices, type RlsDatabase } from '../helpers/rls-database.helper';

export interface SharingDb {
  data: SharingDataAdapter;
  groups: GroupsService;
  members: GroupMembershipService;
  invites: GroupInvitesService;
  principalGroups: PrincipalGroupsProvider;
  /** Grants (#729). */
  access: AccessPolicy;
  grants: GrantsService;
  prune: GrantsPruneHandler;
  notifications: Array<{ kind: 'user' | 'address'; to: string; data: unknown; key?: string }>;
  events: Array<{ name: string; payload: unknown }>;
  close(): Promise<void>;
}

const noop = (() => () => undefined) as unknown as () => MethodDecorator & ClassDecorator;

/**
 * The sharing services over `db`'s tenant and system pools, built by the real
 * `SharingModule.forRoot` with the app's data adapter and recording doubles
 * for the emitter and the notifier.
 */
export async function sharingServices(
  db: RlsDatabase,
  mode: 'single' | 'multi' = 'single',
  options: { wrapData?: (data: SharingDataPort) => SharingDataPort; grants?: { retentionDays?: number } } = {},
): Promise<SharingDb> {
  const { prisma, system, close } = rlsServices(db);
  const adapter = new SharingDataAdapter(prisma, system);
  const data = (options.wrapData ? options.wrapData(adapter) : adapter) as SharingDataAdapter;
  const notifications: SharingDb['notifications'] = [];
  const events: SharingDb['events'] = [];

  @Module({
    providers: [
      { provide: SHARING_DATA, useValue: data },
      { provide: SHARING_EVENT_EMITTER, useValue: { emit: (name: string, payload: unknown) => events.push({ name, payload }) } },
      {
        provide: SHARING_NOTIFIER,
        useValue: {
          notify: async (key: string, userId: string, payload: unknown) => void notifications.push({ kind: 'user', to: userId, data: payload, key }),
          notifyAddress: async (_key: string, email: string, payload: unknown) => void notifications.push({ kind: 'address', to: email, data: payload }),
        },
      },
      { provide: SHARING_TENANCY, useValue: { mode: () => mode } },
    ],
    exports: [SHARING_DATA, SHARING_EVENT_EMITTER, SHARING_NOTIFIER, SHARING_TENANCY],
  })
  class TestSharingHostModule {}

  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [
      SharingModule.forRoot({
        host: definePlatformHost({ access: { requirePermissions: noop, requireAuthenticated: noop } }),
        imports: [TestSharingHostModule],
        ...(options.grants ? { grants: options.grants } : {}),
      }),
    ],
  }).compile();
  await moduleRef.init();

  return {
    data,
    groups: moduleRef.get(GroupsService),
    members: moduleRef.get(GroupMembershipService),
    invites: moduleRef.get(GroupInvitesService),
    principalGroups: moduleRef.get(PrincipalGroupsProvider),
    access: moduleRef.get(AccessPolicy),
    grants: moduleRef.get(GrantsService),
    prune: moduleRef.get(GrantsPruneHandler),
    notifications,
    events,
    close: async () => {
      await moduleRef.close();
      await close();
    },
  };
}

/** A user principal of `orgId`, with the org permissions of `role`. */
export function principalOf(
  userId: string,
  email: string,
  orgId: string,
  role: 'org_admin' | 'contributor' | 'viewer' = 'contributor',
  memberships: string[] = [orgId],
): Principal {
  const permissions =
    role === 'org_admin'
      ? ['groups:read', 'groups:write', 'groups:admin', 'sharing:read', 'sharing:write', 'sharing:admin']
      : role === 'contributor'
        ? ['groups:read', 'groups:write', 'sharing:read', 'sharing:write']
        : ['groups:read', 'sharing:read'];
  return {
    kind: 'user',
    userId,
    email,
    credential: 'session',
    roles: [],
    permissions,
    activeOrgId: orgId,
    memberships: memberships.map((id) => ({ orgId: id, role, status: 'active' as const })),
  };
}

/** Creates a user and an active membership of each org, through the system pool. */
export async function seedUser(db: RlsDatabase, email: string, orgIds: string[]): Promise<string> {
  const id = randomUUID();
  await db.system.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    let role = await tx.role.findFirst({ where: { name: 'viewer' } });
    if (!role) role = await tx.role.create({ data: { name: 'viewer', description: 'Viewer', scope: 'org' } });
    await tx.user.create({ data: { id, email, providerDisplayName: email } });
    for (const orgId of orgIds) {
      await tx.membership.create({ data: { orgId, userId: id, roleId: role.id, status: 'active' } });
    }
  });
  return id;
}

/** Creates the two organizations every fixture uses, if absent. */
export async function seedOrgs(db: RlsDatabase, orgs: Array<[string, string]>): Promise<void> {
  await db.system.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('app.rls_bypass', 'on', true)`;
    for (const [id, slug] of orgs) {
      await tx.organization.upsert({ where: { id }, create: { id, name: slug, slug }, update: {} });
    }
  });
}
