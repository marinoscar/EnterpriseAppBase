// PATCH and DELETE /api/grants/:id on a LINK grant (issue #730): the generic
// GrantsService manages links too: the label (links only), the expiry capped
// by links.maxTtlDays, the share_link action, the grant:link:* audit actions
// and the sharing.grant.* events with granteeKind `link`.

import { HttpException } from '@nestjs/common';

import type { Principal } from '../../src/core/index';
import { AccessPolicy, GrantsService, MemberLookupThrottle, SHARING_EVENTS, resolveSharingModuleOptions } from '../../src/sharing/index';
import { PrincipalGroupsProvider } from '../../src/sharing/principal-groups.provider';
import { ALICE, BOB, ORG, fakeData, fakeEffects, fakeTx, options, principal, testHost, type FakeTx } from './fakes';
import { DOC_A, byUser, docType, withTypes } from './grants-fakes';

const NOW = Date.parse('2026-06-01T00:00:00Z');
const DAY = 86_400_000;
const GRANT = '99999999-0000-4000-8000-0000000000aa';

function row(extra: Record<string, unknown> = {}) {
  return {
    id: GRANT,
    orgId: ORG,
    resourceType: 'test_doc',
    resourceId: DOC_A,
    granteeKind: 'link',
    granteeUserId: null,
    granteeGroupId: null,
    role: 'viewer',
    linkTokenHash: 'h',
    linkTokenCiphertext: 'c',
    linkLabel: 'Old',
    expiresAt: null,
    revokedAt: null,
    revokedById: null,
    grantedById: ALICE,
    metadata: null,
    createdAt: new Date(NOW - DAY),
    updatedAt: new Date(NOW - DAY),
    granteeUser: null,
    granteeGroup: null,
    ...extra,
  };
}

function build(tx: FakeTx) {
  const data = fakeData(tx);
  const principalGroups = new PrincipalGroupsProvider(data, options(), undefined, () => 0);
  jest.spyOn(principalGroups, 'groupsFor').mockResolvedValue([]);
  const policy = new AccessPolicy(data, principalGroups, undefined, () => NOW);
  const fx = fakeEffects(tx);
  const resolved = resolveSharingModuleOptions({ host: testHost, links: { maxTtlDays: 30, defaultTtlDays: 7 } });
  const service = new GrantsService(data, policy, principalGroups, new MemberLookupThrottle(), fx.effects, () => NOW, resolved);
  tx.grant.findFirst.mockResolvedValue(row());
  tx.grant.update.mockImplementation(async ({ data: patch }: { data: Record<string, unknown> }) => row(patch));
  return { service, policy, ...fx };
}

const owner = (): Principal => principal({ permissions: ['sharing:read', 'sharing:write'], groups: [] });
const linkDoc = (actions?: Record<string, 'viewer' | 'editor' | 'owner'>) =>
  docType(new Map([[DOC_A, byUser(ALICE)]]), { grantable: { link: ['viewer', 'editor'] }, ...(actions ? { actions } : {}) });

async function status(promise: Promise<unknown>): Promise<[number, unknown]> {
  try {
    await promise;
  } catch (error) {
    return [(error as HttpException).getStatus(), (error as HttpException).getResponse()];
  }
  throw new Error('expected a refusal');
}

describe('GrantsService on link grants (#730)', () => {
  it('finds grants of every kind (links included) to manage', async () => {
    const tx = fakeTx();
    const { service } = build(tx);
    await withTypes([linkDoc()], () => service.update(owner(), GRANT, { role: 'editor' }));
    expect(tx.grant.findFirst.mock.calls[0]![0].where).toEqual({ id: GRANT, orgId: ORG, revokedAt: null });
  });

  it('changes the label and role, caps the expiry at links.maxTtlDays, and audits grant:link:update', async () => {
    const tx = fakeTx();
    const { service, emitted } = build(tx);
    const dto = await withTypes([linkDoc()], () =>
      service.update(owner(), GRANT, { role: 'editor', label: 'Kitchen', expiresAt: new Date(NOW + 400 * DAY).toISOString() }),
    );
    expect(tx.grant.update.mock.calls[0]![0].data).toEqual({ role: 'editor', linkLabel: 'Kitchen', expiresAt: new Date(NOW + 30 * DAY) });
    expect(dto).toMatchObject({ id: GRANT, role: 'editor', grantee: { kind: 'link', userId: null, groupId: null } });
    const audit = tx.auditEvent.create.mock.calls[0]![0].data;
    expect(audit).toMatchObject({ action: 'grant:link:update', targetId: GRANT, meta: { granteeKind: 'link', role: 'editor', previousRole: 'viewer' } });
    expect(JSON.stringify(audit)).not.toMatch(/"h"|"c"/);
    expect(emitted).toEqual([{ name: SHARING_EVENTS.GRANT_UPDATED, payload: expect.objectContaining({ granteeKind: 'link', granteeId: null, previousRole: 'viewer' }) }]);
  });

  it('caps a removed expiry (null) at links.maxTtlDays, and leaves an unsent one alone', async () => {
    const tx = fakeTx();
    const { service } = build(tx);
    await withTypes([linkDoc()], async () => {
      await service.update(owner(), GRANT, { expiresAt: null });
      expect(tx.grant.update.mock.calls[0]![0].data).toEqual({ expiresAt: new Date(NOW + 30 * DAY) });
      await service.update(owner(), GRANT, { label: null });
      expect(tx.grant.update.mock.calls[1]![0].data).toEqual({ linkLabel: null });
    });
  });

  it('refuses a label on a user grant (422 NOT_A_LINK_GRANT) and a role links may not carry (422)', async () => {
    const tx = fakeTx();
    const { service } = build(tx);
    await withTypes([linkDoc()], async () => {
      tx.grant.findFirst.mockResolvedValueOnce(row({ granteeKind: 'user', granteeUserId: BOB, granteeUser: { email: 'b@example.com', displayName: null, providerDisplayName: null } }));
      expect(await status(service.update(owner(), GRANT, { label: 'x' }))).toEqual([422, expect.objectContaining({ details: { reason: 'NOT_A_LINK_GRANT' } })]);
    });
    await withTypes([docType(new Map([[DOC_A, byUser(ALICE)]]), { grantable: { link: ['viewer'] } })], async () => {
      expect(await status(service.update(owner(), GRANT, { role: 'editor' }))).toEqual([422, expect.objectContaining({ details: expect.objectContaining({ reason: 'ROLE_NOT_GRANTABLE' }) })]);
    });
  });

  it("checks the type's share_link action to manage a link, and answers others the grant 404", async () => {
    const tx = fakeTx();
    const { service, policy } = build(tx);
    const spy = jest.spyOn(policy, 'requireIn');
    await withTypes([linkDoc({ read: 'viewer', write: 'editor', share: 'owner', share_link: 'editor' })], () => service.revoke(owner(), GRANT));
    expect(spy.mock.calls[0]![2]).toBe('share_link');
    await withTypes([docType(new Map([[DOC_A, byUser(BOB)]]), { grantable: { link: ['viewer'] } })], async () => {
      expect(await status(service.revoke(owner(), GRANT))).toEqual([404, expect.objectContaining({ message: 'Grant not found' })]);
    });
  });

  it('revokes a link softly and audits grant:link:revoke', async () => {
    const tx = fakeTx();
    const { service, emitted } = build(tx);
    await withTypes([linkDoc()], () => service.revoke(owner(), GRANT));
    expect(tx.grant.update.mock.calls[0]![0].data).toEqual({ revokedAt: new Date(NOW), revokedById: ALICE });
    expect(tx.auditEvent.create.mock.calls[0]![0].data).toMatchObject({ action: 'grant:link:revoke', targetId: GRANT });
    expect(emitted[0]).toEqual({ name: SHARING_EVENTS.GRANT_REVOKED, payload: expect.objectContaining({ granteeKind: 'link', granteeId: null }) });
  });
});
