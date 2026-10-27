import type { SeedPrisma } from '../../src/seed/index.js';

/** One call the seed made against the fake client. */
export interface RecordedCall {
  delegate: string;
  method: string;
  args: unknown;
}

/**
 * A client fake that keeps rows in memory, keyed like the real unique
 * indexes, and records every call. A method the seed has no business calling
 * (`delete`, `update`, `create`, `deleteMany`...) is whatever the Proxy hands
 * back for an unknown name: a function that records itself, so a test can
 * assert the set of methods used.
 */
export function createFakePrisma(): { prisma: SeedPrisma; calls: RecordedCall[]; tables: Record<string, Map<string, Record<string, unknown>>> } {
  const calls: RecordedCall[] = [];
  const tables: Record<string, Map<string, Record<string, unknown>>> = {
    role: new Map(),
    permission: new Map(),
    rolePermission: new Map(),
    systemSettings: new Map(),
    allowedEmail: new Map(),
    organization: new Map(),
  };
  let nextId = 1;

  const keyOf = (delegate: string, where: Record<string, unknown>): string => {
    if (delegate === 'rolePermission') {
      const pair = where.roleId_permissionId as { roleId: string; permissionId: string };
      return `${pair.roleId}|${pair.permissionId}`;
    }
    return String(Object.values(where)[0]);
  };

  const delegateFor = (delegate: string): object =>
    new Proxy(
      {},
      {
        get: (_target, method: string) => async (args: Record<string, unknown>) => {
          calls.push({ delegate, method, args });
          const table = tables[delegate]!;
          if (method === 'upsert') {
            const key = keyOf(delegate, args.where as Record<string, unknown>);
            const existing = table.get(key);
            const row = existing
              ? { ...existing, ...(args.update as object) }
              : { id: `id-${nextId++}`, ...(args.create as object) };
            table.set(key, row);
            return row;
          }
          if (method === 'findFirst') {
            // Only `organization.findFirst({ where: { isDefault: true } })` exists.
            const where = args.where as Record<string, unknown>;
            return [...table.values()].find((row) => Object.entries(where).every(([k, v]) => row[k] === v)) ?? null;
          }
          if (method === 'findUnique') {
            return table.get(keyOf(delegate, args.where as Record<string, unknown>)) ?? null;
          }
          throw new Error(`unexpected call ${delegate}.${method}`);
        },
      },
    );

  const prisma = Object.fromEntries(Object.keys(tables).map((name) => [name, delegateFor(name)])) as unknown as SeedPrisma;
  return { prisma, calls, tables };
}
