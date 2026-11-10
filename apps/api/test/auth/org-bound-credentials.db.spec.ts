// =============================================================================
// Real-Postgres test: credentials are bound to an organization (PP-6.4, #724)
// =============================================================================
//
// What only real rows can prove: that `refresh_tokens.org_id` and
// `personal_access_tokens.org_id` (added nullable by #721) are written at
// issue, and that removing or suspending the `memberships` row really kills
// the refresh chain and the PAT bound to that org, while the user's other
// memberships keep working. Also that `switchOrg` rotates the refresh row to
// the new org and writes its `auth:org_switched` audit row.
//
// The services are the real ones, wired by hand onto a real Prisma client,
// with a real, enabled principal cache; only the collaborators with no
// bearing on this (notifications, allowlist, admin bootstrap) are stubbed.
// Every user and organization is created with a run-unique name and deleted in
// `afterAll` (memberships and tokens cascade).
//
// THIS IS A `*.db.spec.ts` FILE — skipped with a warning when no Postgres is
// reachable; see `test/jobs/db-test-support.ts`. Run with `npm run test:db`
// against a migrated database (no seed needed: the default organization and
// the `viewer` org role come from the migrations).
// =============================================================================

import { randomUUID } from 'node:crypto';

import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { PrismaClient } from '@prisma/client';

import {
  AuthService,
  PRINCIPAL_USER_INCLUDE,
  PrincipalCache,
  recordTenancyMode,
  OrganizationsService,
  TenancyService,
  PatService,
} from '@marinoscar/platform-api/identity';
import { InProcessEventBus } from '@marinoscar/platform-api/host';
import type { PrismaService } from '../../src/prisma/prisma.service';
import { createDbClient, resolveDbSuite } from '../jobs/db-test-support';
import { AppProfileImages, AppUserDefaults } from '../../src/platform/identity/identity-user.adapters';
import { asIdentityPrisma } from '../../src/platform/identity/identity-db';


const { describeWithDb } = resolveDbSuite('org-bound-credentials.db.spec');

describeWithDb('org-bound credentials (real Postgres, #724)', () => {
  let client: PrismaClient;
  let jwt: JwtService;
  let cache: PrincipalCache;
  let organizations: OrganizationsService;
  let pats: PatService;
  const run = randomUUID().slice(0, 8);
  const userIds: string[] = [];
  const orgIds: string[] = [];
  let defaultOrgId: string;
  let viewerRoleId: string;

  /** AuthService in one tenancy mode, over the shared client, cache and org service. */
  function authIn(mode: 'single' | 'multi'): AuthService {
    const config = new ConfigService({
      jwt: { accessTtlMinutes: 15, refreshTtlDays: 14 },
      tenancy: { mode },
    });
    return new AuthService(
      asIdentityPrisma(client as unknown as PrismaService),
      jwt,
      config,
      {} as never,
      {} as never,
      {} as never,
      cache,
      organizations,
      new TenancyService(config),
      undefined,
      new AppUserDefaults(),
      new AppProfileImages(),
    );
  }

  async function makeUser(label: string, extraOrgs: string[] = []) {
    const user = await client.user.create({
      data: { email: `${label}-${run}@example.com`, isActive: true },
      select: { id: true },
    });
    userIds.push(user.id);
    for (const orgId of [defaultOrgId, ...extraOrgs]) {
      await client.membership.create({ data: { orgId, userId: user.id, roleId: viewerRoleId } });
    }
    return user.id;
  }

  async function makeOrg(label: string) {
    const org = await client.organization.create({
      data: { name: `Org ${label} ${run}`, slug: `org-${label}-${run}` },
      select: { id: true },
    });
    orgIds.push(org.id);
    return org.id;
  }

  const graphOf = (userId: string) =>
    client.user.findUniqueOrThrow({ where: { id: userId }, include: PRINCIPAL_USER_INCLUDE });

  beforeAll(async () => {
    client = createDbClient();
    jwt = new JwtService({ secret: 'org-bound-credentials-db-spec' });
    cache = new PrincipalCache(new ConfigService({}), new InProcessEventBus());
    organizations = new OrganizationsService(asIdentityPrisma(client as unknown as PrismaService), cache);
    pats = new PatService(asIdentityPrisma(client as unknown as PrismaService), cache);
    defaultOrgId = (await client.organization.findFirstOrThrow({ where: { isDefault: true } })).id;
    viewerRoleId = (await client.role.findUniqueOrThrow({ where: { name: 'viewer' } })).id;
  });

  afterAll(async () => {
    recordTenancyMode('single');
    await client.auditEvent.deleteMany({ where: { actorUserId: { in: userIds } } });
    await client.user.deleteMany({ where: { id: { in: userIds } } });
    await client.organization.deleteMany({ where: { id: { in: orgIds } } });
    await client.$disconnect();
  });

  it('writes org_id on the refresh row and the org claim on the access token', async () => {
    const auth = authIn('single');
    const userId = await makeUser('issue');

    const tokens = await auth.generateFullTokens(await graphOf(userId));

    expect(jwt.verify(tokens.accessToken).org).toBe(defaultOrgId);
    const [row] = await client.refreshToken.findMany({ where: { userId } });
    expect(row.orgId).toBe(defaultOrgId);
  });

  it('removing the membership kills the refresh chain and the cached access token of that org', async () => {
    const auth = authIn('multi');
    const orgB = await makeOrg('removal');
    const userId = await makeUser('removal', [orgB]);

    const tokens = await auth.generateFullTokens(await graphOf(userId), { orgId: orgB });
    const payload = jwt.verify(tokens.accessToken);
    await expect(auth.validateJwtPayload(payload)).resolves.toMatchObject({ id: userId }); // cached now

    await organizations.removeMembership(orgB, userId);

    await expect(auth.validateJwtPayload(payload)).resolves.toBeNull();
    await expect(auth.refreshAccessToken(tokens.refreshToken!)).rejects.toBeInstanceOf(UnauthorizedException);
    const live = await client.refreshToken.count({ where: { userId, revokedAt: null } });
    expect(live).toBe(0);

    // The other membership still works.
    const other = await auth.generateFullTokens(await graphOf(userId), { orgId: defaultOrgId });
    await expect(auth.validateJwtPayload(jwt.verify(other.accessToken))).resolves.toMatchObject({ id: userId });
  });

  it('suspending the membership refuses the refresh of that org (401)', async () => {
    const auth = authIn('multi');
    const orgB = await makeOrg('suspend');
    const userId = await makeUser('suspend', [orgB]);
    const tokens = await auth.generateFullTokens(await graphOf(userId), { orgId: orgB });

    await organizations.setMembershipStatus(orgB, userId, 'suspended');

    await expect(auth.refreshAccessToken(tokens.refreshToken!)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('a PAT created in org A cannot be used once the membership in A is removed', async () => {
    recordTenancyMode('single');
    const orgA = await makeOrg('pat');
    const userId = await makeUser('pat', [orgA]);

    const pat = await pats.createToken(
      userId,
      { name: 'CI', durationValue: 1, durationUnit: 'days', orgId: orgA },
      { activeOrgId: defaultOrgId },
    );
    expect(pat.orgId).toBe(orgA);
    expect((await client.personalAccessToken.findUniqueOrThrow({ where: { id: pat.id } })).orgId).toBe(orgA);
    await expect(pats.validateToken(pat.token)).resolves.toMatchObject({ id: userId, activeOrgId: orgA });

    await organizations.removeMembership(orgA, userId);

    await expect(pats.validateToken(pat.token)).resolves.toBeNull();
  });

  it('refuses (400) a PAT for an org the caller is not a member of', async () => {
    const orgX = await makeOrg('foreign');
    const userId = await makeUser('foreign');

    await expect(
      pats.createToken(userId, { name: 'CI', durationValue: 1, durationUnit: 'days', orgId: orgX }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(await client.personalAccessToken.count({ where: { userId } })).toBe(0);
  });

  it('switchOrg rotates the refresh row to the new org and audits it', async () => {
    const auth = authIn('multi');
    const orgB = await makeOrg('switch');
    const userId = await makeUser('switch', [orgB]);
    const tokens = await auth.generateFullTokens(await graphOf(userId), { orgId: defaultOrgId });

    const switched = await auth.switchOrg(
      { id: userId, tokenKind: 'session', activeOrgId: defaultOrgId },
      orgB,
      tokens.refreshToken,
    );

    expect(jwt.verify(switched.accessToken).org).toBe(orgB);
    const rows = await client.refreshToken.findMany({ where: { userId }, orderBy: { createdAt: 'asc' } });
    expect(rows.map((row) => [row.orgId, row.revokedAt !== null])).toEqual([
      [defaultOrgId, true],
      [orgB, false],
    ]);
    const audit = await client.auditEvent.findFirstOrThrow({
      where: { actorUserId: userId, action: 'auth:org_switched' },
    });
    expect(audit).toMatchObject({ targetType: 'organization', targetId: orgB, meta: { fromOrgId: defaultOrgId } });
    const membership = await client.membership.findUniqueOrThrow({
      where: { orgId_userId: { orgId: orgB, userId } },
    });
    expect(membership.lastActiveAt).not.toBeNull();

    // The old cookie is spent.
    await expect(
      auth.switchOrg({ id: userId, tokenKind: 'session' }, defaultOrgId, tokens.refreshToken),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
