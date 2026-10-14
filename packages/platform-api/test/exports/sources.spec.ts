import { registerModelOwnership, registerUserOwnedModels } from '../../src/core';
import { orgDataTables, userDataTables, type ExportContext, type ExportTable } from '../../src/exports';
import { FIXTURE_DATAMODEL, UUID, fakeDb, type RecordedQuery } from './support';

registerUserOwnedModels([
  { model: 'ApiToken', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'tokens' },
  { model: 'Diary', ownerField: 'userId', purge: 'delete', export: 'include', exportOmit: ['private'], rationale: 'diary' },
  { model: 'Session', ownerField: 'userId', purge: 'delete', export: 'exclude', rationale: 'session' },
  { model: 'Audit', actorFields: ['actorId'], purge: 'detach', export: 'include', rationale: 'audit' },
  { model: 'Pair', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'pair' },
  { model: 'Membership', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'membership' },
  { model: 'Vault', actorFields: ['userId'], purge: 'detach', export: 'exclude', rationale: 'vault' } as never,
]);
registerModelOwnership([
  { model: 'Folder', kind: 'org', rationale: 'folder' },
  { model: 'Vault', kind: 'org', rationale: 'vault' },
]);

async function drain(tables: AsyncIterable<ExportTable>): Promise<Record<string, Array<Record<string, unknown>>>> {
  const out: Record<string, Array<Record<string, unknown>>> = {};
  for await (const table of tables) {
    out[table.dataset] = [];
    for await (const row of table.rows) out[table.dataset]!.push({ ...row });
  }
  return out;
}

function ctx(db: Record<string, any>, subjectId: string, scope: 'user' | 'org' = 'user'): ExportContext {
  return {
    exportId: UUID.job,
    scope,
    subjectId,
    requestedById: UUID.user,
    db,
    datamodel: FIXTURE_DATAMODEL,
    pageSize: 2,
    now: new Date('2026-01-01T00:00:00.000Z'),
  };
}

describe('the user-data source', () => {
  const rows = {
    user: [
      { id: UUID.user, email: 'me@example.test', createdAt: new Date('2026-01-01T00:00:00.000Z') },
      { id: UUID.other, email: 'other@example.test', createdAt: new Date('2026-01-01T00:00:00.000Z') },
    ],
    apiToken: [
      { id: 't1', userId: UUID.user, name: 'cli', tokenHash: 'HASH-1', hint: 'HINT', lastUsedAt: null },
      { id: 't2', userId: UUID.user, name: 'ci', tokenHash: 'HASH-2', hint: 'HINT', lastUsedAt: null },
      { id: 't3', userId: UUID.user, name: 'bot', tokenHash: 'HASH-3', hint: 'HINT', lastUsedAt: null },
      { id: 't4', userId: UUID.other, name: 'theirs', tokenHash: 'HASH-4', hint: 'HINT', lastUsedAt: null },
    ],
    diary: [{ id: 'd1', userId: UUID.user, body: 'dear diary', blob: Buffer.from('BYTES'), mood: 'ok', score: 3, size: BigInt(7), meta: { a: 1 }, private: 'PRIVATE' }],
    session: [{ id: 's1', userId: UUID.user, refreshSecret: 'SECRET' }],
    audit: [
      { id: 'a1', actorId: UUID.user, action: 'login' },
      { id: 'a2', actorId: UUID.other, action: 'login' },
    ],
    pair: [
      { userId: UUID.user, roleId: 'r1' },
      { userId: UUID.user, roleId: 'r2' },
      { userId: UUID.user, roleId: 'r3' },
    ],
    membership: [{ id: 'm1', orgId: UUID.orgA, userId: UUID.user }],
  };

  it('exports the account and one dataset per included model, owner rows only, redacted, paged', async () => {
    const queries: RecordedQuery[] = [];
    const out = await drain(userDataTables(ctx(fakeDb(structuredClone(rows), queries), UUID.user)));

    expect(Object.keys(out)).toEqual(['account', 'api_token', 'diary', 'audit', 'pair', 'membership']);
    expect(out.account).toEqual([{ id: UUID.user, email: 'me@example.test', createdAt: '2026-01-01T00:00:00.000Z' }]);
    expect(out.api_token!.map((r) => r.name)).toEqual(['cli', 'ci', 'bot']);
    expect(out.api_token![0]).toEqual({ id: 't1', userId: UUID.user, name: 'cli', lastUsedAt: null });
    expect(out.diary).toEqual([{ id: 'd1', userId: UUID.user, body: 'dear diary', mood: 'ok', score: 3, size: 7, meta: '{"a":1}' }]);
    expect(out.audit).toEqual([{ id: 'a1', actorId: UUID.user, action: 'login' }]);
    expect(out.pair).toHaveLength(3);

    // The redacted columns are never selected, so they never leave the database.
    const tokenQueries = queries.filter((q) => q.delegate === 'apiToken');
    expect(tokenQueries.length).toBe(2); // pages of 2: 2 + 1
    for (const query of tokenQueries) {
      expect(Object.keys(query.args.select)).not.toContain('tokenHash');
      expect(Object.keys(query.args.select)).not.toContain('hint');
    }
    expect(tokenQueries[1]!.args.where).toEqual({ AND: [{ userId: UUID.user }, { id: { gt: 't2' } }] });
    // A composite key is paged by offset.
    expect(queries.filter((q) => q.delegate === 'pair').map((q) => q.args.skip)).toEqual([0, 2]);
    // The excluded model is never read.
    expect(queries.some((q) => q.delegate === 'session')).toBe(false);
  });
});

describe('the org-data source', () => {
  const rows = {
    organization: [
      { id: UUID.orgA, name: 'A' },
      { id: UUID.orgB, name: 'B' },
    ],
    membership: [
      { id: 'm1', orgId: UUID.orgA, userId: UUID.user, status: 'active', createdAt: new Date('2026-01-01T00:00:00.000Z'), user: { email: 'me@example.test' }, role: { name: 'org_admin' } },
      { id: 'm2', orgId: UUID.orgB, userId: UUID.other, status: 'active', createdAt: new Date('2026-01-01T00:00:00.000Z'), user: { email: 'other@example.test' }, role: { name: 'viewer' } },
    ],
    folder: [
      { id: 'f1', orgId: UUID.orgA, title: 'Ours', linkTokenCiphertext: 'CIPHER' },
      { id: 'f2', orgId: UUID.orgB, title: 'Theirs', linkTokenCiphertext: 'CIPHER' },
    ],
    vault: [{ id: 'v1', orgId: UUID.orgA, secret: 'SECRET' }],
  };

  it("exports the organization, its members and its org-owned rows only, skipping excluded models", async () => {
    const queries: RecordedQuery[] = [];
    const out = await drain(orgDataTables(ctx(fakeDb(structuredClone(rows), queries), UUID.orgA, 'org')));
    expect(Object.keys(out)).toEqual(['organization', 'members', 'folder']);
    expect(out.organization).toEqual([{ id: UUID.orgA, name: 'A' }]);
    expect(out.members).toEqual([
      { user_id: UUID.user, email: 'me@example.test', role: 'org_admin', status: 'active', joined_at: '2026-01-01T00:00:00.000Z' },
    ]);
    expect(out.folder).toEqual([{ id: 'f1', orgId: UUID.orgA, title: 'Ours' }]);
    for (const query of queries) {
      if (query.delegate === 'organization') expect(query.args.where).toEqual({ id: UUID.orgA });
      else expect(JSON.stringify(query.args.where)).toContain(UUID.orgA);
    }
    expect(queries.some((q) => q.delegate === 'vault')).toBe(false);
  });
});
