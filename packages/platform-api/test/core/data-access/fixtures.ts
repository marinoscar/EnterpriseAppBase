// Shared fixtures for the data-access specs: a registry lookup shaped like the
// reference app's inventory, and a fake client that implements `$extends` the
// way Prisma does (a `defineExtension` function is called with the client; an
// object extension routes every call through its `$allOperations` hook). No
// database. NOT a `*.spec.ts` file, so Jest never runs it as a suite.

import type { UserOwnedModelDef, UserOwnedModelLookup } from '../../../src/core';

export const A = '00000000-0000-4000-8000-00000000000a';
export const B = '00000000-0000-4000-8000-00000000000b';

export const FIXTURE_DEFS: readonly UserOwnedModelDef[] = [
  { model: 'UserCredential', ownerField: 'userId', purge: 'delete', export: 'include', exportOmit: ['secret'], rationale: 'Own keys.' },
  { model: 'Notification', ownerField: 'userId', purge: 'delete', export: 'include', rationale: 'Inbox.' },
  { model: 'StorageObject', ownerField: 'uploadedById', purge: 'detach', export: 'include', rationale: 'Uploads.' },
  { model: 'WorkerNode', ownerField: 'createdById', purge: 'delete', export: 'exclude', rationale: 'Nodes.' },
  { model: 'AuditEvent', actorFields: ['actorUserId'], purge: 'detach', export: 'include', rationale: 'Audit.' },
];

export const fixtureRegistry: UserOwnedModelLookup = {
  get: (model) => FIXTURE_DEFS.find((def) => def.model === model),
};

/** One call the fake client's terminal `query` received. */
export interface QueryCall {
  model: string | undefined;
  operation: string;
  args: unknown;
}

type Hook = (params: { model?: string; operation: string; args: unknown; query: (args: unknown) => Promise<unknown> }) => unknown;

const RAW = ['$queryRaw', '$executeRaw', '$queryRawUnsafe', '$executeRawUnsafe'];

/**
 * A client with `$extends` only. Calling `ext.userCredential.findMany(args)` on
 * the extended client runs the extension's hook with `model: 'UserCredential'`;
 * the terminal `query` records what it would have sent to the database.
 */
export function fakeClient(): { client: { $extends(extension: unknown): unknown }; calls: QueryCall[]; names: string[] } {
  const calls: QueryCall[] = [];
  const names: string[] = [];
  const client = {
    $extends(extension: unknown): unknown {
      if (typeof extension === 'function') return (extension as (c: unknown) => unknown)(client);
      const ext = extension as { name?: string; query: { $allOperations: Hook } };
      if (ext.name) names.push(ext.name);
      const hook = ext.query.$allOperations;
      const run = (model: string | undefined, operation: string, args: unknown) =>
        hook({ model, operation, args, query: async (sent) => (calls.push({ model, operation, args: sent }), sent) });
      return new Proxy(
        {},
        {
          get: (_target, prop: string) => {
            if (RAW.includes(prop)) return (...args: unknown[]) => run(undefined, prop, args);
            const model = prop.charAt(0).toUpperCase() + prop.slice(1);
            return new Proxy({}, { get: (_t, operation: string) => (args: unknown) => run(model, operation, args) });
          },
        },
      );
    },
  };
  return { client, calls, names };
}
