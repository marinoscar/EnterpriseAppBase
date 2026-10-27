// =============================================================================
// A tiny in-memory stand-in for the three tables the AI key services touch
// (issue #431). TEST-ONLY.
//
// It implements exactly the `where` / `select` shapes `UserAiKeysService`,
// `UsableModelsService` and `AiKeyResolver` use — not Prisma — so "set, then
// list" means something in a unit test and a scoping bug (a query that forgot
// `userId`) actually returns another user's row instead of agreeing with a
// stub. Unknown shapes throw, so a service change that this fake does not
// understand fails loudly rather than silently matching everything.
// =============================================================================

import { randomUUID } from 'node:crypto';

/**
 * A `user_ai_keys` row in the in-memory store.
 *
 * @stability experimental
 */
export interface FakeUserAiKeyRow {
  /** Row id. */
  id: string;
  /** The owner. */
  userId: string;
  /** Provider id. */
  provider: string;
  /** Ciphertext, as the service wrote it. */
  secret: string;
  /** The key's last characters. */
  hint: string | null;
  /** When it last verified. */
  verifiedAt: Date | null;
  /** The last verification failure's code. */
  lastErrorCode: string | null;
  /** Models the key reached at the last check. */
  reachableModelIds: string[];
  /** When `reachableModelIds` was computed. */
  reachableCheckedAt: Date | null;
  /** Created. */
  createdAt: Date;
  /** Last change. */
  updatedAt: Date;
}

/**
 * An `ai_models` row in the in-memory store.
 *
 * @stability experimental
 */
export interface FakeAiModelRow {
  /** Row id. */
  id: string;
  /** Provider id. */
  provider: string;
  /** Model id. */
  modelId: string;
  /** Display name. */
  displayName: string | null;
  /** The capability set, as JSON. */
  capabilities: unknown;
  /** Whether an administrator enabled it. */
  enabled: boolean;
  /** When the provider stopped listing it. */
  deprecatedAt: Date | null;
  /** First seen. */
  discoveredAt: Date;
}

/**
 * The `user_ai_keys` delegate of the in-memory client: each method a
 * `jest.fn` over the store.
 *
 * @stability experimental
 */
export interface InMemoryUserAiKeyDelegate {
  /** `findMany` (`where`, `select`, `orderBy`, `take`). */
  findMany: jest.Mock;
  /** `findUnique` (`where`, `select`). */
  findUnique: jest.Mock;
  /** `count` (`where`). */
  count: jest.Mock;
  /** `upsert` (`where`, `create`, `update`, `select`). */
  upsert: jest.Mock;
  /** `updateMany` (`where`, `data`). */
  updateMany: jest.Mock;
  /** `deleteMany` (`where`). */
  deleteMany: jest.Mock;
}

/**
 * The `ai_models` delegate of the in-memory client.
 *
 * @stability experimental
 */
export interface InMemoryAiModelDelegate {
  /** `findMany` (`where`, `select`). */
  findMany: jest.Mock;
  /** `findUnique` (`where`, `select`). */
  findUnique: jest.Mock;
  /** `findFirst` (`where`, `select`, `orderBy`). */
  findFirst: jest.Mock;
}

/**
 * The in-memory stand-in for the client the AI key services use.
 *
 * @stability experimental
 */
export interface InMemoryAiKeysClient {
  /** `user_ai_keys`. */
  userAiKey: InMemoryUserAiKeyDelegate;
  /** `ai_models`. */
  aiModel: InMemoryAiModelDelegate;
  /** `audit_events`: `create` records the row's data in `audits`. */
  auditEvent: {
    /** `create` (`data`). */
    create: jest.Mock;
  };
}

/**
 * What {@link createInMemoryAiKeysPrisma} returns: the client and its store.
 *
 * @stability experimental
 */
export interface InMemoryAiKeysPrisma {
  /** The client to inject as `PLATFORM_PRISMA`. */
  prisma: InMemoryAiKeysClient;
  /** The stored keys (mutable). */
  keys: FakeUserAiKeyRow[];
  /** The stored models (mutable). */
  models: FakeAiModelRow[];
  /** Every audit row's data, in order. */
  audits: Array<Record<string, unknown>>;
  /**
   * Adds a model (enabled, OpenAI, text responses by default).
   *
   * @param overrides - the fields to set; `modelId` is required.
   * @returns the stored row.
   */
  addModel(overrides: Partial<FakeAiModelRow> & { modelId: string }): FakeAiModelRow;
}

type Where = Record<string, any>;

function pick<T extends object>(row: T, select?: Record<string, boolean>): Partial<T> {
  if (!select) return { ...row };
  const out: Record<string, unknown> = {};
  for (const [key, on] of Object.entries(select)) {
    if (on) out[key] = (row as Record<string, unknown>)[key];
  }
  return out as Partial<T>;
}

function matchValue(actual: unknown, expected: any): boolean {
  if (expected === null) return actual === null;
  if (expected instanceof Date) return actual instanceof Date && actual.getTime() === expected.getTime();
  if (typeof expected === 'object' && !Array.isArray(expected)) {
    for (const [op, value] of Object.entries(expected)) {
      switch (op) {
        case 'in':
          if (!(value as unknown[]).includes(actual)) return false;
          break;
        case 'gt':
          if (!(actual !== null && (actual as any) > (value as any))) return false;
          break;
        case 'lt':
          if (!(actual !== null && (actual as any) < (value as any))) return false;
          break;
        default:
          throw new Error(`in-memory prisma: unsupported operator "${op}"`);
      }
    }
    return true;
  }
  return actual === expected;
}

function matches(row: Record<string, unknown>, where: Where = {}): boolean {
  for (const [key, expected] of Object.entries(where)) {
    if (key === 'OR') {
      if (!(expected as Where[]).some((branch) => matches(row, branch))) return false;
      continue;
    }
    if (key === 'userId_provider') {
      if (row.userId !== expected.userId || row.provider !== expected.provider) return false;
      continue;
    }
    if (key === 'provider_modelId') {
      if (row.provider !== expected.provider || row.modelId !== expected.modelId) return false;
      continue;
    }
    if (!matchValue(row[key], expected)) return false;
  }
  return true;
}

function ordered<T extends Record<string, any>>(rows: T[], orderBy?: Record<string, 'asc' | 'desc'>): T[] {
  if (!orderBy) return rows;
  const [[field, dir]] = Object.entries(orderBy);
  return [...rows].sort((a, b) => {
    const cmp = a[field] < b[field] ? -1 : a[field] > b[field] ? 1 : 0;
    return dir === 'desc' ? -cmp : cmp;
  });
}

/**
 * A tiny in-memory stand-in for the tables the AI key services touch
 * (`user_ai_keys`, `ai_models`, `audit_events`). It understands exactly the
 * `where`/`select` shapes those services use and throws on any other, so a
 * scoping bug returns the wrong row instead of agreeing with a stub.
 *
 * @returns the client and its store.
 *
 * @stability experimental
 */
export function createInMemoryAiKeysPrisma(): InMemoryAiKeysPrisma {
  const keys: FakeUserAiKeyRow[] = [];
  const models: FakeAiModelRow[] = [];
  const audits: Array<Record<string, unknown>> = [];

  const prisma: InMemoryAiKeysClient = {
    userAiKey: {
      findMany: jest.fn(async (args: { where?: Where; select?: any; orderBy?: any; take?: number } = {}) => {
        let rows = ordered(
          keys.filter((row) => matches(row as never, args.where)),
          args.orderBy,
        );
        if (args.take !== undefined) rows = rows.slice(0, args.take);
        return rows.map((row) => pick(row, args.select));
      }),
      findUnique: jest.fn(async (args: { where: Where; select?: any }) => {
        const row = keys.find((candidate) => matches(candidate as never, args.where));
        return row ? pick(row, args.select) : null;
      }),
      count: jest.fn(async (args: { where?: Where } = {}) =>
        keys.filter((row) => matches(row as never, args.where)).length,
      ),
      upsert: jest.fn(async (args: { where: Where; create: any; update: any; select?: any }) => {
        let row = keys.find((candidate) => matches(candidate as never, args.where));
        const now = new Date();
        if (row) {
          Object.assign(row, args.update, { updatedAt: now });
        } else {
          row = {
            id: randomUUID(),
            hint: null,
            verifiedAt: null,
            lastErrorCode: null,
            reachableModelIds: [],
            reachableCheckedAt: null,
            createdAt: now,
            updatedAt: now,
            ...args.create,
          } as FakeUserAiKeyRow;
          keys.push(row);
        }
        return pick(row, args.select);
      }),
      updateMany: jest.fn(async (args: { where: Where; data: any }) => {
        const rows = keys.filter((row) => matches(row as never, args.where));
        for (const row of rows) Object.assign(row, args.data, { updatedAt: new Date() });
        return { count: rows.length };
      }),
      deleteMany: jest.fn(async (args: { where: Where }) => {
        const before = keys.length;
        for (let i = keys.length - 1; i >= 0; i -= 1) {
          if (matches(keys[i] as never, args.where)) keys.splice(i, 1);
        }
        return { count: before - keys.length };
      }),
    },
    aiModel: {
      findMany: jest.fn(async (args: { where?: Where; select?: any; orderBy?: any } = {}) =>
        models.filter((row) => matches(row as never, args.where)).map((row) => pick(row, args.select)),
      ),
      findUnique: jest.fn(async (args: { where: Where; select?: any }) => {
        const row = models.find((candidate) => matches(candidate as never, args.where));
        return row ? pick(row, args.select) : null;
      }),
      findFirst: jest.fn(async (args: { where?: Where; select?: any; orderBy?: any } = {}) => {
        const row = ordered(
          models.filter((candidate) => matches(candidate as never, args.where)),
          args.orderBy,
        )[0];
        return row ? pick(row, args.select) : null;
      }),
    },
    auditEvent: {
      create: jest.fn(async (args: { data: Record<string, unknown> }) => {
        audits.push(args.data);
        return { id: randomUUID(), ...args.data };
      }),
    },
  };

  return {
    prisma,
    keys,
    models,
    audits,
    addModel(overrides: Partial<FakeAiModelRow> & { modelId: string }): FakeAiModelRow {
      const row: FakeAiModelRow = {
        id: randomUUID(),
        provider: 'openai',
        displayName: null,
        capabilities: {
          capabilities: ['responses', 'streaming'],
          inputModalities: ['text'],
          outputModalities: ['text'],
        },
        enabled: true,
        deprecatedAt: null,
        discoveredAt: new Date('2026-01-01T00:00:00.000Z'),
        ...overrides,
      };
      models.push(row);
      return row;
    },
  };
}

