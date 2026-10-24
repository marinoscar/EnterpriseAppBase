// Shared fixtures for the exports slice's specs (#744).
import type { ExportDatamodel, ExportDatamodelModel } from '../../src/exports';

function field(name: string, type: string, extra: Partial<ExportDatamodelModel['fields'][number]> = {}) {
  return { name, kind: 'scalar', type, isList: false, ...extra };
}

/** A small datamodel shaped like the platform's: a user, credential-like models, an org model. */
export const FIXTURE_DATAMODEL: ExportDatamodel = {
  models: [
    {
      name: 'User',
      fields: [field('id', 'String', { isId: true }), field('email', 'String'), field('createdAt', 'DateTime'), { name: 'tokens', kind: 'object', type: 'ApiToken', isList: true }],
    },
    {
      name: 'ApiToken',
      fields: [
        field('id', 'String', { isId: true }),
        field('userId', 'String'),
        field('name', 'String'),
        field('tokenHash', 'String'),
        field('hint', 'String'),
        field('lastUsedAt', 'DateTime'),
      ],
    },
    {
      name: 'Diary',
      fields: [
        field('id', 'String', { isId: true }),
        field('userId', 'String'),
        field('body', 'String'),
        field('blob', 'Bytes'),
        field('mood', 'Mood', { kind: 'enum' }),
        field('score', 'Int'),
        field('size', 'BigInt'),
        field('meta', 'Json'),
        field('private', 'String'),
      ],
    },
    { name: 'Session', fields: [field('id', 'String', { isId: true }), field('userId', 'String'), field('refreshSecret', 'String')] },
    { name: 'Audit', fields: [field('id', 'String', { isId: true }), field('actorId', 'String'), field('action', 'String')] },
    { name: 'Pair', fields: [field('userId', 'String'), field('roleId', 'String')], primaryKey: { fields: ['userId', 'roleId'] } },
    { name: 'Organization', fields: [field('id', 'String', { isId: true }), field('name', 'String')] },
    { name: 'Membership', fields: [field('id', 'String', { isId: true }), field('orgId', 'String'), field('userId', 'String')] },
    { name: 'Folder', fields: [field('id', 'String', { isId: true }), field('orgId', 'String'), field('title', 'String'), field('linkTokenCiphertext', 'String')] },
    { name: 'Vault', fields: [field('id', 'String', { isId: true }), field('orgId', 'String'), field('secret', 'String')] },
  ],
};

/** A recorded `findMany` call. */
export interface RecordedQuery {
  delegate: string;
  args: Record<string, any>;
}

/**
 * A fake client: `rows[delegate]` are filtered by a tiny `where` evaluator
 * (equality, `gt`, `AND`, `OR`), ordered by id, paged with `take`/`skip`,
 * and `select`ed. Every query is recorded.
 */
export function fakeDb(rows: Record<string, Array<Record<string, any>>>, queries: RecordedQuery[] = []) {
  const matches = (row: Record<string, any>, where: Record<string, any> | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, value]) => {
      if (key === 'AND') return (value as any[]).every((w) => matches(row, w));
      if (key === 'OR') return (value as any[]).some((w) => matches(row, w));
      if (value && typeof value === 'object' && !(value instanceof Date)) {
        if ('gt' in value) return row[key] > value.gt;
        if ('in' in value) return (value.in as unknown[]).includes(row[key]);
        if ('notIn' in value) return !(value.notIn as unknown[]).includes(row[key]);
        if ('lt' in value) return row[key] < value.lt;
        if ('startsWith' in value) return typeof row[key] === 'string' && row[key].startsWith(value.startsWith);
        return true;
      }
      return row[key] === value;
    });
  };
  const db: Record<string, any> = {};
  for (const [delegate, list] of Object.entries(rows)) {
    db[delegate] = {
      findMany: async (args: Record<string, any> = {}) => {
        queries.push({ delegate, args });
        const sorted = [...list].filter((row) => matches(row, args.where));
        const keys = (args.orderBy ? (Array.isArray(args.orderBy) ? args.orderBy : [args.orderBy]) : []).map((o: object) => Object.keys(o)[0]!);
        sorted.sort((a, b) => {
          for (const key of keys) {
            if (a[key] < b[key]) return -1;
            if (a[key] > b[key]) return 1;
          }
          return 0;
        });
        const page = sorted.slice(args.skip ?? 0, (args.skip ?? 0) + (args.take ?? sorted.length));
        if (!args.select) return page;
        return page.map((row) => {
          const out: Record<string, any> = {};
          for (const [key, value] of Object.entries(args.select)) {
            if (value === true) out[key] = row[key];
            else if (value && typeof value === 'object') out[key] = row[key];
          }
          return out;
        });
      },
      findFirst: async (args: Record<string, any> = {}) => (await db[delegate].findMany({ ...args, take: 1 }))[0] ?? null,
      findUnique: async (args: Record<string, any> = {}) => (await db[delegate].findMany({ ...args, take: 1 }))[0] ?? null,
      deleteMany: async (args: Record<string, any> = {}) => {
        const before = list.length;
        for (let i = list.length - 1; i >= 0; i -= 1) if (matches(list[i]!, args.where)) list.splice(i, 1);
        return { count: before - list.length };
      },
    };
  }
  return db;
}

/** A valid v4 UUID for fixtures. */
export const UUID = {
  user: '11111111-1111-4111-8111-111111111111',
  other: '22222222-2222-4222-8222-222222222222',
  orgA: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  orgB: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  job: '33333333-3333-4333-8333-333333333333',
  object: '44444444-4444-4444-8444-444444444444',
};
