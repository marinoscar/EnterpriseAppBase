// The storage specs' deep mock of the slice's structural client
// (`StoragePrisma`), the counterpart of apps/api/test/mocks/prisma.mock.ts
// (#736): the specs moved here with the code they test, and a package never
// imports an app or a generated client.
//
// `forOrg(orgId)` returns the mock itself and `runInOrg(orgId, fn)` runs `fn`
// with the mock as the transaction client (through the mock's `$transaction`
// when a spec implemented one), exactly as the app's mock does, so a spec
// asserts on the SAME `storageObject.create` it always did. Whether the scope
// is applied is proven against a real database by the app's
// `test/tenancy/storage-org-isolation.db.spec.ts`.

import { DeepMockProxy, mockDeep } from 'jest-mock-extended';

import type { StoragePrisma } from '../../../src/storage/data/storage-db';

/** A deep mock of the slice's client, with every delegate the specs touch. */
export type MockPrismaService = DeepMockProxy<StoragePrisma> & { [model: string]: any };

/** The single-mode default organization every mocked database answers with. */
export const MOCK_DEFAULT_ORG_ID = '99999999-9999-4999-8999-999999999999';

function withOrgScope<T extends object>(mock: T): T {
  const scoped: Record<string, unknown> = {
    forOrg: () => proxy,
    runInOrg: (_orgId: string, fn: (tx: unknown) => unknown) => {
      let ran = false;
      const unit = (tx: unknown) => {
        ran = true;
        return fn(tx);
      };
      const result = (mock as { $transaction?: (u: unknown) => unknown }).$transaction?.(unit);
      return ran ? result : fn(proxy);
    },
  };
  const proxy: T = new Proxy(mock, {
    get(target, prop, receiver) {
      if (typeof prop === 'string' && prop in scoped) return scoped[prop];
      return Reflect.get(target, prop, receiver);
    },
    set(target, prop, value, receiver) {
      if (typeof prop === 'string' && prop in scoped) {
        scoped[prop] = value;
        return true;
      }
      return Reflect.set(target, prop, value, receiver);
    },
  });
  return proxy;
}

/** A fresh mock of the slice's client, for one spec. */
export function createMockPrismaService(): MockPrismaService {
  const mock = mockDeep<StoragePrisma>() as MockPrismaService;
  mock.organization.findFirst.mockResolvedValue({ id: MOCK_DEFAULT_ORG_ID });
  return withOrgScope(mock);
}
