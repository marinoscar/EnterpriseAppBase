// =============================================================================
// Link shares through the real AppModule, mocked Prisma (#730, PP-7.3)
// =============================================================================
//
// Drives the link routes over HTTP with the app's own @Auth() (through the
// platform host) and the deliberately public resolution route:
//
//   - the 503 without SECRETS_ENCRYPTION_KEY (first: the cipher caches the
//     key on its first success);
//   - the RBAC matrix of /api/grants/links, and the public route answering
//     without any authentication;
//   - minting: the URL `<APP_URL>/s#lnk_...` and the token once, the row
//     holding only the hash and the ciphertext; a type without link roles
//     refused with 422;
//   - resolution: 200 with Cache-Control: no-store and Referrer-Policy:
//     no-referrer; unknown, malformed, missing, revoked, expired and
//     links-off tokens all the IDENTICAL 404; a token in the path or the
//     query is never read; revocation effective on the next request;
//   - the per-address miss throttle: the 31st request is 429 with Retry-After;
//   - a sentinel egress check (modelled on test/ai/ai-secret-egress): no log
//     line, audit row, event payload, error body or response header carries
//     a token.
//
// The real-row versions (hash uniqueness, withLinkScope under RLS across two
// organizations, a guarded app route) are in ./link-grants.db.spec.ts.
// =============================================================================

import { createHash } from 'node:crypto';

import request from 'supertest';
import { Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { LinkMissThrottle, registerResourceType, type ResourceOwnerInfo } from '@marinoscar/platform-api/sharing';

import { authHeader, createMockTestUser, type TestUser } from '../helpers/auth-mock.helper';
import { TestContext, closeTestApp, createTestApp } from '../helpers/test-app.helper';
import { setupBaseMocks } from '../fixtures/mock-setup.helper';
import { MOCK_DEFAULT_ORG_ID } from '../fixtures/test-data.factory';
import { resetPrismaMock } from '../mocks/prisma.mock';

const ORG = MOCK_DEFAULT_ORG_ID;
const DOC = '66666666-6666-4666-8666-666666666601';
const PLAIN = '66666666-6666-4666-8666-666666666602';
const APP_URL = 'https://links.example.test';
/** A well-formed token no grant has: every failed resolution sends it, and it must surface nowhere. */
const SENTINEL = `lnk_SENTINEL${'x'.repeat(35)}`;
const KEY = Buffer.alloc(32, 9).toString('base64');

const ORIGINAL_KEY = process.env.SECRETS_ENCRYPTION_KEY;
const ORIGINAL_APP_URL = process.env.APP_URL;

const owners = new Map<string, ResourceOwnerInfo>();
const loadOwners = async (ids: readonly string[]) => new Map([...owners].filter(([id]) => ids.includes(id)));
registerResourceType({
  type: 'it_link_doc',
  roles: ['viewer', 'editor'],
  actions: { read: 'viewer', write: 'editor', share: 'owner' },
  ownership: 'user',
  grantable: { link: ['viewer'] },
  loadOwners,
  describe: async (ids) => new Map(ids.map((id) => [id, { title: 'Holiday album' }])),
});
registerResourceType({
  type: 'it_plain_doc',
  roles: ['viewer'],
  actions: { read: 'viewer', share: 'owner' },
  ownership: 'user',
  loadOwners,
});

type Role = 'org_admin' | 'contributor' | 'viewer';
type Row = Record<string, unknown> & { id: string };

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');

describe('link shares (#730)', () => {
  let context: TestContext;
  const users: Partial<Record<Role, TestUser>> = {};
  const rows = new Map<string, Row>();
  const tokens: string[] = [];
  const errorBodies: string[] = [];
  const headerDumps: string[] = [];
  const auditDumps: string[] = [];
  const logLines: string[] = [];
  let logSpies: jest.SpyInstance[] = [];
  let emitSpy: jest.SpyInstance;

  beforeAll(async () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    process.env.APP_URL = APP_URL;
    context = await createTestApp({ useMockDatabase: true });
    emitSpy = jest.spyOn(context.app.get(EventEmitter2), 'emit');
  }, 60_000);

  afterAll(async () => {
    await closeTestApp(context);
    if (ORIGINAL_KEY === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = ORIGINAL_KEY;
    if (ORIGINAL_APP_URL === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = ORIGINAL_APP_URL;
  });

  beforeEach(async () => {
    resetPrismaMock();
    setupBaseMocks();
    owners.clear();
    rows.clear();
    context.app.get(LinkMissThrottle).clear();
    const prisma = context.prismaMock;
    const live = (row: Row | undefined) => (row && row.revokedAt === null ? row : null);
    prisma.grant.create.mockImplementation(async ({ data }: { data: Row }) => {
      const row = { revokedAt: null, revokedById: null, metadata: null, granteeUserId: null, granteeGroupId: null, createdAt: new Date(), updatedAt: new Date(), ...data };
      rows.set(row.id, row);
      return row;
    });
    prisma.grant.findUnique.mockImplementation(async ({ where }: { where: { id?: string; linkTokenHash?: string } }) =>
      where.linkTokenHash ? ([...rows.values()].find((row) => row.linkTokenHash === where.linkTokenHash) ?? null) : (rows.get(where.id!) ?? null),
    );
    prisma.grant.findFirst.mockImplementation(async ({ where }: { where: Record<string, unknown> }) => {
      if (where.id) return live(rows.get(where.id as string));
      return [...rows.values()].find((row) => row.revokedAt === null && row.role === where.role && row.grantedById === where.grantedById) ?? null;
    });
    prisma.grant.update.mockImplementation(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = { ...rows.get(where.id)!, ...data, updatedAt: new Date() };
      rows.set(where.id, row);
      return { ...row, granteeUser: null, granteeGroup: null };
    });
    prisma.grant.findMany.mockImplementation(async ({ where }: { where: Record<string, unknown> }) =>
      where.granteeKind === 'link' ? [...rows.values()].filter((row) => row.resourceId === where.resourceId && row.revokedAt === null) : [],
    );
    prisma.grant.count.mockResolvedValue(0);
    prisma.groupMember.findMany.mockResolvedValue([]);
    for (const role of ['org_admin', 'contributor', 'viewer'] as const) {
      users[role] = await createMockTestUser(context, { systemRoles: [], orgRoleName: role, email: `${role}@example.com` });
    }
    owners.set(DOC, { orgId: ORG, owner: { kind: 'user', userId: users.contributor!.id } });
    owners.set(PLAIN, { orgId: ORG, owner: { kind: 'user', userId: users.contributor!.id } });
    logSpies = (['log', 'warn', 'error', 'debug', 'verbose'] as const).map((method) =>
      jest.spyOn(Logger.prototype, method).mockImplementation((...args: unknown[]) => {
        logLines.push(args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      }),
    );
  });

  afterEach(() => {
    for (const spy of logSpies) spy.mockRestore();
    // resetPrismaMock() clears the calls before the next test: keep them for the egress check.
    auditDumps.push(JSON.stringify(context.prismaMock.auditEvent.create.mock.calls));
  });

  const http = () => request(context.app.getHttpServer());

  /** Resolves through the public route, recording every error body and header for the egress check. */
  async function resolveLink(token?: string, path = '/api/public/links/current') {
    let req = http().get(path);
    if (token !== undefined) req = req.set('X-Link-Token', token);
    const res = await req;
    headerDumps.push(JSON.stringify(res.headers));
    if (res.status >= 400) errorBodies.push(JSON.stringify(res.body));
    return res;
  }

  async function mint(body: Record<string, unknown> = {}, as: Role = 'contributor') {
    const res = await http().post('/api/grants/links').set(authHeader(users[as]!.accessToken)).send({ resourceType: 'it_link_doc', resourceId: DOC, ...body });
    if (res.body?.data?.token) tokens.push(res.body.data.token);
    return res;
  }

  it('refuses link creation with 503 and a remedy while SECRETS_ENCRYPTION_KEY is not configured', async () => {
    const res = await mint();
    expect(res.status).toBe(503);
    expect(res.body.details.reason).toBe('LINKS_UNAVAILABLE');
    expect(res.body.message).toMatch(/SECRETS_ENCRYPTION_KEY.*openssl rand -base64 32/);
    expect(context.prismaMock.grant.create).not.toHaveBeenCalled();
    process.env.SECRETS_ENCRYPTION_KEY = KEY; // every later test has a key
  });

  describe('RBAC matrix (the record does not exist)', () => {
    const MISSING = '66666666-6666-4666-8666-666666666699';
    const MATRIX = [
      { method: 'post' as const, path: '/api/grants/links', body: { resourceType: 'it_link_doc', resourceId: MISSING }, expect: { org_admin: 404, contributor: 404, viewer: 403, anonymous: 401 } },
      { method: 'get' as const, path: `/api/grants/links?resourceType=it_link_doc&resourceId=${MISSING}`, expect: { org_admin: 404, contributor: 404, viewer: 404, anonymous: 401 } },
      // Deliberately public: authentication changes nothing, the missing token is the 404.
      { method: 'get' as const, path: '/api/public/links/current', expect: { org_admin: 404, contributor: 404, viewer: 404, anonymous: 404 } },
    ];
    for (const row of MATRIX) {
      it(`${row.method.toUpperCase()} ${row.path.split('?')[0]}`, async () => {
        const got: Record<string, number> = {};
        for (const role of ['org_admin', 'contributor', 'viewer', 'anonymous'] as const) {
          let req = http()[row.method](row.path);
          if (role !== 'anonymous') req = req.set(authHeader(users[role]!.accessToken));
          got[role] = (await (row.body ? req.send(row.body) : req)).status;
        }
        expect(got).toEqual(row.expect);
      });
    }
  });

  it('mints a link: the URL carries the token in the fragment, the token comes back once, the row holds only the hash and the ciphertext', async () => {
    const res = await mint({ label: 'Printer' });
    expect(res.status).toBe(201);
    const { url, token, grant } = res.body.data;
    expect(token).toMatch(/^lnk_[A-Za-z0-9_-]{43}$/);
    expect(url).toBe(`${APP_URL}/s#${token}`);
    expect(grant).toMatchObject({ resourceType: 'it_link_doc', resourceId: DOC, role: 'viewer', label: 'Printer', url, revokedAt: null });
    const data = context.prismaMock.grant.create.mock.calls[0]![0].data;
    expect(data).toMatchObject({ granteeKind: 'link', linkTokenHash: sha256(token), linkTokenCiphertext: expect.any(String) });
    expect(JSON.stringify(data)).not.toContain(token);
    const audit = context.prismaMock.auditEvent.create.mock.calls.map((c: [{ data: { action: string } }]) => c[0].data.action);
    expect(audit).toContain('grant:link:create');

    // The list re-derives the URL from the ciphertext.
    const list = await http().get(`/api/grants/links?resourceType=it_link_doc&resourceId=${DOC}`).set(authHeader(users.contributor!.accessToken)).expect(200);
    expect(list.body.data.items).toEqual([expect.objectContaining({ id: grant.id, url, label: 'Printer' })]);
  });

  it("refuses a link on a type that grants links no role (422), and a non-owner's link (404)", async () => {
    const plain = await http().post('/api/grants/links').set(authHeader(users.contributor!.accessToken)).send({ resourceType: 'it_plain_doc', resourceId: PLAIN });
    expect(plain.status).toBe(422);
    expect(plain.body.details).toMatchObject({ reason: 'ROLE_NOT_GRANTABLE', grantable: [] });
    const notOwner = await http().post('/api/grants/links').set(authHeader(users.viewer!.accessToken)).send({ resourceType: 'it_link_doc', resourceId: DOC });
    expect(notOwner.status).toBe(403); // viewer lacks sharing:write
    owners.set(DOC, { orgId: ORG, owner: { kind: 'user', userId: users.viewer!.id } });
    expect((await mint()).status).toBe(404);
  });

  it('reuses the caller\'s active link with reuseActive: true', async () => {
    const first = await mint();
    const again = await mint({ reuseActive: true });
    expect(again.status).toBe(201);
    expect(again.body.data.token).toBe(first.body.data.token);
    expect(rows.size).toBe(1);
  });

  it('resolves a valid token publicly, with no-store and no-referrer, and the record title', async () => {
    const { token, grant } = (await mint()).body.data;
    const res = await resolveLink(token);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ resourceType: 'it_link_doc', resourceId: DOC, role: 'viewer', expiresAt: grant.expiresAt, title: 'Holiday album' });
    expect(grant.expiresAt).not.toBeNull(); // the 30-day default
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
  });

  it('answers unknown, malformed, missing, revoked, expired and links-off tokens with the IDENTICAL 404', async () => {
    const revoked = (await mint()).body.data;
    await http().delete(`/api/grants/${revoked.grant.id}`).set(authHeader(users.contributor!.accessToken)).expect(204);
    const expired = (await mint()).body.data;
    rows.set(expired.grant.id, { ...rows.get(expired.grant.id)!, expiresAt: new Date(Date.now() - 1000) });
    // A link to a type that (no longer) grants links any role.
    const off = `lnk_OFF${'y'.repeat(40)}`;
    rows.set('99999999-0000-4000-8000-0000000000ff', {
      id: '99999999-0000-4000-8000-0000000000ff', orgId: ORG, resourceType: 'it_plain_doc', resourceId: PLAIN, granteeKind: 'link', role: 'viewer',
      linkTokenHash: sha256(off), linkTokenCiphertext: 'c', expiresAt: null, revokedAt: null,
    });

    const answers = [];
    for (const token of [SENTINEL, 'lnk_short', 'not-a-token', undefined, revoked.token, expired.token, off]) {
      const res = await resolveLink(token);
      expect(res.status).toBe(404);
      expect(res.headers['cache-control']).toBe('no-store');
      const { timestamp: _t, ...body } = res.body;
      answers.push(body);
    }
    for (const body of answers) expect(body).toEqual(answers[0]);
    expect(answers[0]).toMatchObject({ statusCode: 404, message: 'Link not found' });
  });

  it('never reads a token from the path or the query string (404)', async () => {
    const { token } = (await mint()).body.data;
    // A client that puts a token in the URL leaks it itself (the request line is logged, by
    // nginx too): exactly why the share URL carries it in the fragment. Not an egress of the API.
    tokens.splice(tokens.indexOf(token), 1);
    expect((await request(context.app.getHttpServer()).get(`/api/public/links/current?token=${token}&x-link-token=${token}`)).status).toBe(404);
    expect((await request(context.app.getHttpServer()).get(`/api/public/links/current/${token}`)).status).toBe(404);
    expect((await resolveLink(token)).status).toBe(200);
  });

  it('makes a revoked link a 404 on the very next request, and audits the revocation', async () => {
    const { token, grant } = (await mint()).body.data;
    expect((await resolveLink(token)).status).toBe(200);
    await http().delete(`/api/grants/${grant.id}`).set(authHeader(users.contributor!.accessToken)).expect(204);
    expect((await resolveLink(token)).status).toBe(404);
    const actions = context.prismaMock.auditEvent.create.mock.calls.map((c: [{ data: { action: string } }]) => c[0].data.action);
    expect(actions).toContain('grant:link:revoke');
  });

  it('changes a link label through PATCH /api/grants/:id (grant:link:update)', async () => {
    const { grant } = (await mint()).body.data;
    const res = await http().patch(`/api/grants/${grant.id}`).set(authHeader(users.contributor!.accessToken)).send({ label: 'Kitchen' });
    expect(res.status).toBe(200);
    expect(rows.get(grant.id)!.linkLabel).toBe('Kitchen');
    const actions = context.prismaMock.auditEvent.create.mock.calls.map((c: [{ data: { action: string } }]) => c[0].data.action);
    expect(actions).toContain('grant:link:update');
  });

  it('answers 429 with Retry-After after 30 misses from one address in 10 minutes, even for a valid token', async () => {
    const { token } = (await mint()).body.data;
    for (let i = 0; i < 30; i += 1) expect((await resolveLink(SENTINEL)).status).toBe(404);
    const throttled = await resolveLink(token);
    expect(throttled.status).toBe(429);
    expect(throttled.body.details).toMatchObject({ reason: 'LINK_RESOLUTION_THROTTLED', retryAfterMs: expect.any(Number) });
    expect(Number(throttled.headers['retry-after'])).toBeGreaterThan(0);
    expect(throttled.headers['cache-control']).toBe('no-store');
  });

  // LAST: everything the suite above did is the haystack.
  it('leaks no token into a log line, an audit row, an event, an error body or a response header', () => {
    expect(tokens.length).toBeGreaterThan(5);
    const audit = auditDumps.join('\n');
    expect(audit).toContain('grant:link:create');
    const events = JSON.stringify(emitSpy.mock.calls);
    const haystacks = { logs: logLines.join('\n'), audit, events, errors: errorBodies.join('\n'), headers: headerDumps.join('\n') };
    for (const secret of [SENTINEL, ...tokens]) {
      for (const [where, text] of Object.entries(haystacks)) {
        if (text.includes(secret)) throw new Error(`${where} leaks a link token: ${text.split('\n').find((line) => line.includes(secret))}`);
        if (text.includes(sha256(secret))) throw new Error(`${where} leaks a link token hash`);
      }
    }
    // The refusals were logged: with the reason enum and an address tag only.
    const refusals = logLines.filter((line) => line.includes('Link resolution refused'));
    expect(refusals.length).toBeGreaterThan(30);
    for (const line of refusals) expect(line).toMatch(/Link resolution refused: reason=[a-z_]+ address=[0-9a-f]{12}/);
  });
});
