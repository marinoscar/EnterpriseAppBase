// LinkGrantsService (issue #730): minting (the lnk_ prefix, the SHA-256 hash,
// the ciphertext bound to the grant id, never the clear token in the row),
// the 503 without SECRETS_ENCRYPTION_KEY, grantable link roles, the share /
// share_link action, reuseActive, the caps, the TTL defaulting and capping,
// resolution (every failure, the one bypass lookup by hash), withLinkScope
// (the link's org, no user), the list's re-derived URLs and
// importLegacyToken. The real-database versions are
// apps/api/test/sharing/link-grants.db.spec.ts.

import { createHash } from 'node:crypto';

import { HttpException } from '@nestjs/common';

import { decryptSecret } from '../../src/core/index';
import type { Principal } from '../../src/core/index';
import {
  AccessPolicy,
  LinkGrantsService,
  SHARING_EVENTS,
  importLegacyToken,
  resolveLinkExpiry,
  resolveSharingModuleOptions,
  type ResourceTypeDef,
} from '../../src/sharing/index';
import { PrincipalGroupsProvider } from '../../src/sharing/principal-groups.provider';
import { ALICE, BOB, ORG, OTHER_ORG, fakeData, fakeEffects, fakeTx, options, principal, stringsIn, testHost, type FakeTx } from './fakes';
import { DOC_A, byUser, docType, withTypes, type OwnerTable } from './grants-fakes';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const DAY = 86_400_000;
const TOKEN_RE = /^lnk_[A-Za-z0-9_-]{43}$/;
const KEY = Buffer.alloc(32, 7).toString('base64');

const linkType = (table: OwnerTable, overrides: Partial<ResourceTypeDef<'viewer' | 'editor'>> = {}) =>
  docType(table, { grantable: { link: ['viewer', 'editor'] }, ...overrides }) as ResourceTypeDef;

/** The created rows, by id, so reads see writes. */
function store(tx: FakeTx) {
  const rows = new Map<string, Record<string, unknown>>();
  tx.grant.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    const row = { revokedAt: null, revokedById: null, metadata: null, createdAt: new Date(NOW), updatedAt: new Date(NOW), ...data };
    rows.set(data.id as string, row);
    return row;
  });
  return rows;
}

function build(tx: FakeTx, linkOptions: Parameters<typeof resolveSharingModuleOptions>[0]['links'] = {}) {
  const data = fakeData(tx);
  const principalGroups = new PrincipalGroupsProvider(data, options(), undefined, () => 0);
  jest.spyOn(principalGroups, 'groupsFor').mockResolvedValue([]);
  const policy = new AccessPolicy(data, principalGroups, undefined, () => NOW);
  const fx = fakeEffects(tx);
  const resolved = resolveSharingModuleOptions({ host: testHost, links: { appUrl: () => 'https://app.example.com/', ...linkOptions } });
  const service = new LinkGrantsService(data, policy, fx.effects, resolved, () => NOW);
  return { service, data, policy, ...fx };
}

const owner = (permissions: string[] = ['sharing:read', 'sharing:write']): Principal => principal({ permissions, groups: [] });
const table = () => new Map([[DOC_A, byUser(ALICE)]]);
const base = { resourceType: 'test_doc', resourceId: DOC_A } as const;

async function status(promise: Promise<unknown>): Promise<[number, unknown]> {
  try {
    await promise;
  } catch (error) {
    return [(error as HttpException).getStatus(), (error as HttpException).getResponse()];
  }
  throw new Error('expected a refusal');
}

describe('LinkGrantsService', () => {
  const originalKey = process.env.SECRETS_ENCRYPTION_KEY;
  afterAll(() => {
    if (originalKey === undefined) delete process.env.SECRETS_ENCRYPTION_KEY;
    else process.env.SECRETS_ENCRYPTION_KEY = originalKey;
  });

  // FIRST: the cipher caches the key on its first success, so this runs before any key is set.
  it('fails closed with 503 and a remedy when SECRETS_ENCRYPTION_KEY is not configured', async () => {
    delete process.env.SECRETS_ENCRYPTION_KEY;
    const tx = fakeTx();
    const { service } = build(tx);
    await withTypes([linkType(table())], async () => {
      const [code, body] = await status(service.create(owner(), { ...base }));
      expect(code).toBe(503);
      expect(body).toMatchObject({ details: { reason: 'LINKS_UNAVAILABLE' }, message: expect.stringContaining('openssl rand -base64 32') });
      expect(tx.grant.create).not.toHaveBeenCalled();
    });
  });

  describe('with a key', () => {
    beforeAll(() => {
      process.env.SECRETS_ENCRYPTION_KEY = KEY;
    });

    it('mints lnk_ + 43 base64url characters, stores only the hash and a ciphertext bound to the grant id', async () => {
      const tx = fakeTx();
      const rows = store(tx);
      const { service, emitted } = build(tx);
      await withTypes([linkType(table())], async () => {
        const issued = await service.create(owner(), { ...base, label: 'Printer' });
        expect(issued.token).toMatch(TOKEN_RE);
        expect(issued.url).toBe(`https://app.example.com/s#${issued.token}`);
        expect(issued.grant).toMatchObject({ role: 'viewer', label: 'Printer', url: issued.url, orgId: ORG, grantedById: ALICE });

        const [row] = [...rows.values()];
        expect(row!.id).toBe(issued.grant.id);
        expect(row!.linkTokenHash).toBe(createHash('sha256').update(issued.token).digest('hex'));
        // The ciphertext opens under its own row's domain only.
        expect(decryptSecret(row!.linkTokenCiphertext as string, `sharing.link:${issued.grant.id}`)).toBe(issued.token);
        expect(() => decryptSecret(row!.linkTokenCiphertext as string, 'sharing.link:00000000-0000-4000-8000-000000000000')).toThrow();
        // The clear token is nowhere in the row, the audit row or the event.
        expect(stringsIn(row)).not.toContain(issued.token);
        const audit = tx.auditEvent.create.mock.calls[0]![0];
        expect(audit.data).toMatchObject({ action: 'grant:link:create', targetType: 'grant', targetId: issued.grant.id, orgId: ORG });
        expect(JSON.stringify(audit)).not.toContain(issued.token);
        expect(JSON.stringify(audit)).not.toContain(row!.linkTokenHash as string);
        expect(emitted).toEqual([{ name: SHARING_EVENTS.GRANT_CREATED, payload: expect.objectContaining({ granteeKind: 'link', granteeId: null, role: 'viewer' }) }]);
        expect(JSON.stringify(emitted)).not.toContain(issued.token);
      });
    });

    it('mints a different token every time', async () => {
      const tx = fakeTx();
      store(tx);
      const { service } = build(tx);
      await withTypes([linkType(table())], async () => {
        const a = await service.create(owner(), { ...base });
        const b = await service.create(owner(), { ...base });
        expect(a.token).not.toBe(b.token);
      });
    });

    it('defaults the role to the weakest link role and refuses one the type does not grant to links (422)', async () => {
      const tx = fakeTx();
      store(tx);
      const { service } = build(tx);
      await withTypes([linkType(table(), { grantable: { link: ['editor'] } })], async () => {
        expect((await service.create(owner(), { ...base })).grant.role).toBe('editor');
        const [code, body] = await status(service.create(owner(), { ...base, role: 'viewer' }));
        expect(code).toBe(422);
        expect(body).toMatchObject({ details: { reason: 'ROLE_NOT_GRANTABLE', grantable: ['editor'] } });
      });
    });

    it('refuses every link on a type that lists no link role (links are off unless listed)', async () => {
      const tx = fakeTx();
      const { service } = build(tx);
      await withTypes([docType(table()) as ResourceTypeDef], async () => {
        const [code, body] = await status(service.create(owner(), { ...base }));
        expect(code).toBe(422);
        expect(body).toMatchObject({ details: { reason: 'ROLE_NOT_GRANTABLE', grantable: [] } });
        expect(tx.grant.create).not.toHaveBeenCalled();
      });
    });

    it('answers 404 to a caller who may not share the record, and to an unknown type', async () => {
      const tx = fakeTx();
      const { service } = build(tx);
      await withTypes([linkType(new Map([[DOC_A, byUser(BOB)]]))], async () => {
        const [code, body] = await status(service.create(owner(), { ...base }));
        expect(code).toBe(404);
        const [unknownCode, unknownBody] = await status(service.create(owner(), { ...base, resourceType: 'nope' }));
        expect(unknownCode).toBe(404);
        expect(unknownBody).toEqual(body);
      });
    });

    it("checks the type's share_link action when it declares one (MemoriaHub: an editor may create links)", async () => {
      const tx = fakeTx();
      store(tx);
      const { service, policy } = build(tx);
      const spy = jest.spyOn(policy, 'requireIn');
      await withTypes([linkType(table(), { actions: { read: 'viewer', write: 'editor', share: 'owner', share_link: 'editor' } })], async () => {
        await service.create(owner(), { ...base });
        expect(spy.mock.calls[0]![2]).toBe('share_link');
      });
      spy.mockClear();
      await withTypes([linkType(table())], async () => {
        await service.create(owner(), { ...base });
        expect(spy.mock.calls[0]![2]).toBe('share');
      });
    });

    it("reuseActive returns the caller's active link with the same role instead of creating a second", async () => {
      const tx = fakeTx();
      const rows = store(tx);
      const { service, emitted } = build(tx);
      await withTypes([linkType(table())], async () => {
        const first = await service.create(owner(), { ...base });
        tx.grant.findFirst.mockResolvedValue(rows.get(first.grant.id));
        const again = await service.create(owner(), { ...base, reuseActive: true });
        expect(again.token).toBe(first.token);
        expect(again.grant.id).toBe(first.grant.id);
        expect(rows.size).toBe(1);
        expect(emitted).toHaveLength(1);
        const where = tx.grant.findFirst.mock.calls.at(-1)![0].where;
        expect(where).toMatchObject({ granteeKind: 'link', role: 'viewer', grantedById: ALICE, revokedAt: null, resourceId: DOC_A });
        // Nothing active: a new one.
        tx.grant.findFirst.mockResolvedValue(null);
        const fresh = await service.create(owner(), { ...base, reuseActive: true });
        expect(fresh.token).not.toBe(first.token);
      });
    });

    it('refuses past links.maxActivePerResource (409 LINK_LIMIT_REACHED) and the type cap (409 GRANT_LIMIT_REACHED)', async () => {
      const tx = fakeTx();
      store(tx);
      const { service } = build(tx, { maxActivePerResource: 2 });
      await withTypes([linkType(table(), { maxGrantsPerResource: 5 })], async () => {
        tx.grant.count.mockResolvedValueOnce(2);
        expect(await status(service.create(owner(), { ...base }))).toEqual([409, expect.objectContaining({ details: { reason: 'LINK_LIMIT_REACHED' } })]);
        tx.grant.count.mockResolvedValueOnce(1).mockResolvedValueOnce(5);
        expect(await status(service.create(owner(), { ...base }))).toEqual([409, expect.objectContaining({ details: { reason: 'GRANT_LIMIT_REACHED' } })]);
        // The link cap counts active, unexpired links of the record only.
        expect(tx.grant.count.mock.calls[0]![0].where).toMatchObject({ granteeKind: 'link', revokedAt: null, resourceId: DOC_A });
      });
    });

    it('defaults and caps the expiry on creation', async () => {
      const tx = fakeTx();
      const rows = store(tx);
      const { service } = build(tx, { defaultTtlDays: 7, maxTtlDays: 30 });
      await withTypes([linkType(table())], async () => {
        const absent = await service.create(owner(), { ...base });
        expect(rows.get(absent.grant.id)!.expiresAt).toEqual(new Date(NOW + 7 * DAY));
        const never = await service.create(owner(), { ...base, expiresAt: null });
        expect(rows.get(never.grant.id)!.expiresAt).toEqual(new Date(NOW + 30 * DAY));
        expect((await status(service.create(owner(), { ...base, expiresAt: new Date(NOW - 1).toISOString() })))[0]).toBe(400);
      });
    });

    it('lists the not-revoked links newest first, each URL re-derived from its ciphertext', async () => {
      const tx = fakeTx();
      const rows = store(tx);
      const { service } = build(tx);
      await withTypes([linkType(table())], async () => {
        const issued = await service.create(owner(), { ...base });
        const corrupt = { ...rows.get(issued.grant.id)!, id: '99999999-0000-4000-8000-000000000009' };
        tx.grant.findMany.mockResolvedValue([rows.get(issued.grant.id), corrupt]);
        tx.grant.count.mockResolvedValue(2);
        const page = await service.list(owner(), { ...base, page: 1, pageSize: 20 });
        expect(page.items[0]!.url).toBe(issued.url);
        // A ciphertext copied onto another row cannot be shown.
        expect(page.items[1]!.url).toBeNull();
        expect(tx.grant.findMany.mock.calls.at(-1)![0]).toMatchObject({
          where: { orgId: ORG, granteeKind: 'link', revokedAt: null, resourceId: DOC_A },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        });
      });
    });

    describe('resolve', () => {
      const ROW = {
        id: '99999999-0000-4000-8000-000000000001',
        orgId: ORG,
        resourceType: 'test_doc',
        resourceId: DOC_A,
        granteeKind: 'link',
        role: 'viewer',
        expiresAt: null,
        revokedAt: null,
      };
      const token = `lnk_${'A'.repeat(43)}`;

      async function resolveWith(row: Record<string, unknown> | null, expect_ = { resourceType: 'test_doc', action: 'read' }, tableRows = table(), def?: ResourceTypeDef) {
        const tx = fakeTx();
        tx.grant.findUnique.mockResolvedValue(row);
        const built = build(tx);
        const result = await withTypes([def ?? linkType(tableRows)], () => built.service.resolve(token, expect_));
        return { result, tx, ...built };
      }

      it('looks up ONE row by the token hash on the bypass client, then checks the record in the grant org', async () => {
        const { result, tx, data } = await resolveWith(ROW);
        expect(result).toEqual({ ok: true, link: { grantId: ROW.id, orgId: ORG, resourceType: 'test_doc', resourceId: DOC_A, role: 'viewer', expiresAt: null } });
        expect(data.systemReasons).toEqual(['link-resolution']);
        expect(tx.grant.findUnique.mock.calls[0]![0].where).toEqual({ linkTokenHash: createHash('sha256').update(token).digest('hex') });
        expect(data.scopes).toEqual([{ orgId: ORG }]);
      });

      it.each([
        ['missing', undefined],
        ['missing', ''],
        ['malformed', 'lnk_short'],
        ['malformed', `pat_${'A'.repeat(43)}`],
        ['malformed', [token, token]],
      ])('refuses a %s token before any lookup', async (failure, value) => {
        const tx = fakeTx();
        const { service, data } = build(tx);
        await withTypes([linkType(table())], async () => {
          expect(await service.resolve(value, { resourceType: 'test_doc' })).toEqual({ ok: false, failure, resourceType: null });
        });
        expect(data.systemReasons).toEqual([]);
      });

      it.each([
        ['unknown', null, {}],
        ['revoked', { ...ROW, revokedAt: new Date(NOW - DAY) }, {}],
        ['expired', { ...ROW, expiresAt: new Date(NOW) }, {}],
        ['wrong_type', ROW, { resourceType: 'album' }],
        ['insufficient_role', ROW, { action: 'write' }],
      ])('reports %s', async (failure, row, over) => {
        const { result } = await resolveWith(row, { resourceType: 'test_doc', action: 'read', ...over });
        expect(result).toMatchObject({ ok: false, failure });
      });

      it('reports links_off when the type no longer grants the role to links, and resource_gone for a deleted or moved record', async () => {
        expect((await resolveWith(ROW, undefined, table(), docType(table()) as ResourceTypeDef)).result).toMatchObject({ failure: 'links_off' });
        expect((await resolveWith(ROW, undefined, new Map())).result).toMatchObject({ failure: 'resource_gone' });
        expect((await resolveWith(ROW, undefined, new Map([[DOC_A, byUser(ALICE, OTHER_ORG)]]))).result).toMatchObject({ failure: 'resource_gone' });
      });

      it('accepts any type on the any-type route, and treats an undeclared action as a programming error', async () => {
        expect((await resolveWith(ROW, { resourceType: '*' } as never)).result).toMatchObject({ ok: true });
        await expect(resolveWith(ROW, { resourceType: 'test_doc', action: 'fly' })).rejects.toThrow(/declares no action "fly"/);
      });
    });

    it('withLinkScope runs in the link org with no user id', async () => {
      const tx = fakeTx();
      const { service, data } = build(tx);
      const out = await service.withLinkScope({ grantId: 'g', orgId: OTHER_ORG, resourceType: 'test_doc', resourceId: DOC_A, role: 'viewer', expiresAt: null }, async (got) => {
        expect(got).toBe(tx);
        return 42;
      });
      expect(out).toBe(42);
      expect(data.scopes).toEqual([{ orgId: OTHER_ORG }]);
    });

    it('importLegacyToken prefixes, hashes and encrypts an old token, and refuses a malformed one', async () => {
      const tx = fakeTx();
      const rows = store(tx);
      const legacy = 'B'.repeat(43);
      const { grantId, token } = await importLegacyToken(tx, { orgId: ORG, resourceType: 'test_doc', resourceId: DOC_A, role: 'viewer', token: legacy });
      expect(token).toBe(`lnk_${legacy}`);
      const row = rows.get(grantId)!;
      expect(row.linkTokenHash).toBe(createHash('sha256').update(token).digest('hex'));
      expect(decryptSecret(row.linkTokenCiphertext as string, `sharing.link:${grantId}`)).toBe(token);
      expect(stringsIn(row)).not.toContain(legacy);
      await expect(importLegacyToken(tx, { orgId: ORG, resourceType: 'test_doc', resourceId: DOC_A, role: 'viewer', token: 'short' })).rejects.toThrow(/43 base64url/);
    });
  });
});

describe('resolveLinkExpiry', () => {
  const links = { defaultTtlDays: 30, maxTtlDays: 365 };

  it('applies the default lifetime when the caller sends none (create), and leaves it unchanged (update)', () => {
    expect(resolveLinkExpiry(undefined, links, NOW, 'create')).toEqual(new Date(NOW + 30 * DAY));
    expect(resolveLinkExpiry(undefined, links, NOW, 'update')).toBeUndefined();
  });

  it('caps a missing or distant expiry at maxTtlDays', () => {
    expect(resolveLinkExpiry(null, links, NOW, 'create')).toEqual(new Date(NOW + 365 * DAY));
    expect(resolveLinkExpiry(new Date(NOW + 400 * DAY).toISOString(), links, NOW, 'update')).toEqual(new Date(NOW + 365 * DAY));
    const soon = new Date(NOW + DAY).toISOString();
    expect(resolveLinkExpiry(soon, links, NOW, 'create')).toEqual(new Date(soon));
  });

  it('keeps no expiry when neither a default nor a maximum is set, and refuses the past', () => {
    expect(resolveLinkExpiry(undefined, { defaultTtlDays: null, maxTtlDays: null }, NOW, 'create')).toBeNull();
    expect(resolveLinkExpiry(null, { defaultTtlDays: null, maxTtlDays: null }, NOW, 'update')).toBeNull();
    expect(() => resolveLinkExpiry(new Date(NOW).toISOString(), links, NOW, 'create')).toThrow(HttpException);
  });

  it('validates the link options at forRoot', () => {
    expect(() => resolveSharingModuleOptions({ host: testHost, links: { maxTtlDays: 10, defaultTtlDays: 30 } })).toThrow(/defaultTtlDays/);
    expect(() => resolveSharingModuleOptions({ host: testHost, links: { maxTtlDays: 10, defaultTtlDays: null } })).toThrow(/defaultTtlDays/);
    expect(() => resolveSharingModuleOptions({ host: testHost, links: { maxMissesPerIp: 0 } })).toThrow(/links\.maxMissesPerIp/);
    expect(() => resolveSharingModuleOptions({ host: testHost, links: { appUrl: 'https://x' as never } })).toThrow(/appUrl/);
    expect(resolveSharingModuleOptions({ host: testHost }).links).toMatchObject({ maxTtlDays: 365, defaultTtlDays: 30, maxActivePerResource: 20, maxMissesPerIp: 30, missWindowMs: 600_000 });
    expect(resolveSharingModuleOptions({ host: testHost, links: { maxTtlDays: null, defaultTtlDays: null } }).links).toMatchObject({ maxTtlDays: null, defaultTtlDays: null });
  });
});
