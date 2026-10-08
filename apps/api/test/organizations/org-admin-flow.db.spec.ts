// =============================================================================
// Real-Postgres test: the org administration flow end to end (#726, PP-6.7)
// =============================================================================
//
// What only real rows can prove, in multi-org mode, through the real services
// wired by hand onto a real Prisma client (with a real, enabled principal
// cache; only the notification dispatcher, metrics and admin bootstrap are
// stubbed):
//
//   1. a system admin creates org B with a first-admin invitation (and an
//      allowlist entry for it);
//   2. the invitee signs in (Google, a brand-new account) and is the
//      `org_admin` of B, bound to B, with the invitation marked accepted;
//   3. the org admin invites a contributor, who signs in; changes their role,
//      suspends and reactivates them;
//   4. the last active `org_admin` can be neither demoted nor removed (409);
//   5. org A cannot reach org B's members (404);
//   6. removing the member revokes their refresh tokens and PATs bound to B
//      and their cached access token stops validating; their removed
//      invitation can be renewed;
//   7. an expired invitation is marked `expired` lazily at sign-in.
//
// THIS IS A `*.db.spec.ts` FILE — skipped with a warning when no Postgres is
// reachable; see `test/jobs/db-test-support.ts`. Run with `npm run test:db`
// against a migrated database. The `contributor` role is created when the
// database was not seeded, and removed again afterwards.
// =============================================================================

import { randomUUID } from 'node:crypto';

import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { PrismaClient } from '@prisma/client';

import {
  AllowlistService,
  AuthService,
  PrincipalCache,
  recordTenancyMode,
  OrganizationsService,
  OrganizationsAdminService,
  OrgInvitesService,
  OrgMembersService,
  TenancyService,
  PatService,
} from '@marinoscar/platform-api/identity';
import { InProcessEventBus } from '../../src/common/event-bus/in-process-event-bus';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';
import { AppProfileImages, AppUserDefaults } from '../../src/platform/identity/identity-user.adapters';
import { NotificationsIdentityNotifier } from '../../src/platform/identity/identity-notifier.adapter';
import { asIdentityPrisma } from '../../src/platform/identity/identity-db';


const { describeWithDb } = resolveDbSuite('org-admin-flow.db.spec');

describeWithDb('org administration flow (real Postgres, #726)', () => {
  const run = randomUUID().slice(0, 8);
  const email = (label: string) => `${label}-${run}@example.com`;
  const emails: string[] = [];
  let client: PrismaClient;
  let jwt: JwtService;
  let cache: PrincipalCache;
  let auth: AuthService;
  let admin: OrganizationsAdminService;
  let invites: OrgInvitesService;
  let members: OrgMembersService;
  let pats: PatService;
  let notifications: { notify: jest.Mock; notifyAddress: jest.Mock };
  let operatorId: string;
  let defaultOrgId: string;
  let orgB: string;
  let createdContributorRole = false;

  async function signIn(label: string) {
    emails.push(email(label));
    return auth.handleGoogleLogin({
      id: `google-${label}-${run}`,
      email: email(label),
      displayName: label,
    } as never);
  }

  const userIdOf = async (label: string) =>
    (await client.user.findUniqueOrThrow({ where: { email: email(label) }, select: { id: true } })).id;

  const membershipOf = (orgId: string, userId: string) =>
    client.membership.findUnique({
      where: { orgId_userId: { orgId, userId } },
      include: { role: { select: { name: true } } },
    });

  beforeAll(async () => {
    client = createDbClient();
    const prisma = client as unknown as PrismaService;
    const config = new ConfigService({
      jwt: { accessTtlMinutes: 15, refreshTtlDays: 14 },
      tenancy: { mode: 'multi' },
      appUrl: 'https://app.example.test',
    });
    const tenancy = new TenancyService(config);
    jwt = new JwtService({ secret: 'org-admin-flow-db-spec' });
    cache = new PrincipalCache(new ConfigService({}), new InProcessEventBus());
    notifications = { notify: jest.fn(async () => undefined), notifyAddress: jest.fn(async () => undefined) };
    // Identity raises notifications through IDENTITY_NOTIFIER (#727); the app's
    // adapter turns them into the same `notify` / `notifyAddress` calls.
    const notifier = new NotificationsIdentityNotifier(notifications as never);
    const metrics = { add: jest.fn(), authLogin: jest.fn(), authRefresh: jest.fn() };
    const organizations = new OrganizationsService(asIdentityPrisma(prisma), cache);
    invites = new OrgInvitesService(asIdentityPrisma(prisma), notifier, config, metrics as never);
    members = new OrgMembersService(asIdentityPrisma(prisma), cache, notifier, config, metrics as never);
    admin = new OrganizationsAdminService(asIdentityPrisma(prisma), tenancy, invites);
    pats = new PatService(asIdentityPrisma(prisma), cache);
    auth = new AuthService(
      asIdentityPrisma(prisma),
      jwt,
      config,
      { shouldGrantAdminRole: async () => false } as never,
      new AllowlistService(asIdentityPrisma(prisma), notifier, config),
      notifier,
      cache,
      organizations,
      tenancy,
      metrics as never,
      new AppUserDefaults(),
      new AppProfileImages(),
    );

    defaultOrgId = (await client.organization.findFirstOrThrow({ where: { isDefault: true } })).id;
    if (!(await client.role.findUnique({ where: { name: 'contributor' } }))) {
      await client.role.create({ data: { name: 'contributor', description: 'Standard user', scope: 'org' } });
      createdContributorRole = true;
    }
    emails.push(email('operator'));
    operatorId = (await client.user.create({ data: { email: email('operator'), isActive: true } })).id;
  }, 60_000);

  afterAll(async () => {
    recordTenancyMode('single');
    const users = await client.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
    const ids = users.map((user) => user.id);
    await client.auditEvent.deleteMany({ where: { actorUserId: { in: ids } } });
    if (orgB) await client.organization.deleteMany({ where: { id: orgB } });
    await client.allowedEmail.deleteMany({ where: { email: { in: emails } } });
    await client.user.deleteMany({ where: { id: { in: ids } } });
    if (createdContributorRole) await client.role.deleteMany({ where: { name: 'contributor' } });
    await client.$disconnect();
  });

  it('1. a system admin creates org B with a pending org_admin invitation and an allowlist entry', async () => {
    emails.push(email('alice'));
    const org = await admin.create(operatorId, { name: `Beta ${run}`, slug: `beta-${run}`, firstAdminEmail: email('alice') });
    orgB = org.id;

    expect(org).toMatchObject({ isDefault: false, memberCount: 0 });
    const invite = await client.invite.findUniqueOrThrow({
      where: { orgId_email: { orgId: orgB, email: email('alice') } },
      include: { role: true },
    });
    expect(invite).toMatchObject({ status: 'pending', invitedById: operatorId });
    expect(invite.role?.name).toBe('org_admin');
    expect(invite.expiresAt!.getTime()).toBeGreaterThan(Date.now());
    await expect(client.allowedEmail.findUnique({ where: { email: email('alice') } })).resolves.not.toBeNull();
    const audit = await client.auditEvent.findMany({ where: { actorUserId: operatorId }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((row) => row.action)).toEqual(['org:created', 'allowlist:add', 'org:invite_created']);
    expect(notifications.notifyAddress).toHaveBeenCalledWith(
      'org.invitation',
      email('alice'),
      expect.objectContaining({ orgName: `Beta ${run}`, roleName: 'org_admin' }),
    );
  });

  it('2. the invitee signs in as the org_admin of B, bound to B, and the invitation is accepted', async () => {
    const tokens = await signIn('alice');
    const aliceId = await userIdOf('alice');

    expect(jwt.verify(tokens.accessToken).org).toBe(orgB);
    expect((await membershipOf(orgB, aliceId))?.role.name).toBe('org_admin');
    const invite = await client.invite.findUniqueOrThrow({ where: { orgId_email: { orgId: orgB, email: email('alice') } } });
    expect(invite).toMatchObject({ status: 'accepted', acceptedById: aliceId });
    expect(invite.acceptedAt).not.toBeNull();
    // Not joined to the default org in multi mode.
    expect(await membershipOf(defaultOrgId, aliceId)).toBeNull();
  });

  it('3. the org admin invites a contributor, changes their role, suspends and reactivates them', async () => {
    const aliceId = await userIdOf('alice');
    emails.push(email('bob'));
    await invites.create(aliceId, orgB, { email: email('bob'), roleName: 'contributor' });
    await signIn('bob');
    const bobId = await userIdOf('bob');
    expect((await membershipOf(orgB, bobId))?.role.name).toBe('contributor');

    await expect(members.update(aliceId, orgB, bobId, { roleName: 'viewer' })).resolves.toMatchObject({ role: 'viewer' });
    expect(notifications.notify).toHaveBeenCalledWith(
      'security.role_changed',
      bobId,
      expect.objectContaining({ previousRoles: ['contributor'], currentRoles: ['viewer'] }),
    );
    await members.update(aliceId, orgB, bobId, { status: 'suspended' });
    expect((await membershipOf(orgB, bobId))?.status).toBe('suspended');
    await members.update(aliceId, orgB, bobId, { status: 'active', roleName: 'contributor' });
    expect(await membershipOf(orgB, bobId)).toMatchObject({ status: 'active', role: { name: 'contributor' } });

    const listed = await members.list(orgB, { page: 1, pageSize: 20, status: 'all' });
    expect(listed.items.map((member) => [member.email, member.role]).sort()).toEqual(
      [
        [email('alice'), 'org_admin'],
        [email('bob'), 'contributor'],
      ].sort(),
    );
    const actions = await client.auditEvent.findMany({ where: { actorUserId: aliceId }, select: { action: true } });
    expect(actions.map((row) => row.action)).toEqual(
      expect.arrayContaining(['org:invite_created', 'org:member_updated']),
    );
  });

  it('4. the last active org_admin can be neither demoted nor removed (409)', async () => {
    const aliceId = await userIdOf('alice');
    const bobId = await userIdOf('bob');

    await expect(members.update(bobId, orgB, aliceId, { roleName: 'viewer' })).rejects.toBeInstanceOf(ConflictException);
    await expect(members.update(bobId, orgB, aliceId, { status: 'suspended' })).rejects.toBeInstanceOf(ConflictException);
    await expect(members.remove(bobId, orgB, aliceId)).rejects.toBeInstanceOf(ConflictException);
    expect((await membershipOf(orgB, aliceId))?.role.name).toBe('org_admin');
  });

  it("5. org A cannot reach org B's members (404) and lists only its own", async () => {
    const bobId = await userIdOf('bob');

    await expect(members.update(operatorId, defaultOrgId, bobId, { roleName: 'viewer' })).rejects.toBeInstanceOf(
      NotFoundException,
    );
    await expect(members.remove(operatorId, defaultOrgId, bobId)).rejects.toBeInstanceOf(NotFoundException);
    const listed = await members.list(defaultOrgId, { page: 1, pageSize: 100, status: 'all', search: run });
    expect(listed.items).toEqual([]);
    const invitesOfA = await invites.list(defaultOrgId, { page: 1, pageSize: 100, status: 'all' });
    expect(invitesOfA.items.some((invite) => invite.email.includes(run))).toBe(false);
  });

  it("6. removing a member revokes their org-bound credentials, and their invitation can be renewed", async () => {
    const aliceId = await userIdOf('alice');
    const bobId = await userIdOf('bob');
    const session = await signIn('bob');
    const payload = jwt.verify(session.accessToken);
    expect(payload.org).toBe(orgB);
    await expect(auth.validateJwtPayload(payload)).resolves.toMatchObject({ id: bobId }); // cached now
    const pat = await pats.createToken(bobId, { name: 'CI', durationValue: 1, durationUnit: 'days' }, { activeOrgId: orgB });

    const revoked = await members.remove(aliceId, orgB, bobId);

    expect(revoked.refreshTokens).toBeGreaterThanOrEqual(1);
    expect(revoked.personalAccessTokens).toBe(1);
    expect(await membershipOf(orgB, bobId)).toBeNull();
    expect(await client.refreshToken.count({ where: { userId: bobId, orgId: orgB, revokedAt: null } })).toBe(0);
    expect((await client.personalAccessToken.findUniqueOrThrow({ where: { id: pat.id } })).revokedAt).not.toBeNull();
    await expect(auth.validateJwtPayload(payload)).resolves.toBeNull();
    await expect(pats.validateToken(pat.token)).resolves.toBeNull();
    await expect(auth.refreshAccessToken(session.refreshToken!)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      client.auditEvent.findFirst({ where: { actorUserId: aliceId, action: 'org:member_removed' } }),
    ).resolves.not.toBeNull();

    const renewed = await invites.create(aliceId, orgB, { email: email('bob'), roleName: 'viewer' });
    expect(renewed).toMatchObject({ status: 'pending', role: 'viewer' });
    // Revoking the renewed (pending) invitation works as for any other.
    await invites.revoke(aliceId, orgB, renewed.id);
    expect((await client.invite.findUniqueOrThrow({ where: { id: renewed.id } })).status).toBe('revoked');
  });

  it('7. an expired invitation is marked expired at sign-in and grants nothing', async () => {
    const aliceId = await userIdOf('alice');
    emails.push(email('carol'));
    const created = await invites.create(aliceId, orgB, { email: email('carol'), roleName: 'viewer' });
    await client.invite.update({ where: { id: created.id }, data: { expiresAt: new Date(Date.now() - 1000) } });

    await expect(signIn('carol')).rejects.toMatchObject({ reason: 'no_organization' });

    expect((await client.invite.findUniqueOrThrow({ where: { id: created.id } })).status).toBe('expired');
    expect(await membershipOf(orgB, await userIdOf('carol'))).toBeNull();
  });
});
