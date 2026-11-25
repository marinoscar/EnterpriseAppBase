// The `user-data.registries` Doctor check (#880): the conformance checks, on the running deployment.

import { registerUserOwnedModels } from '../../src/core/index';
import { DoctorCheckRegistry } from '../../src/doctor/index';
import { parsePrismaSchema } from '../../src/testing/index';
import {
  UserDataRegistriesDoctorCheck,
  registerUserDataCategory,
  registerUserDataModels,
  resolveUserDataModuleOptions,
} from '../../src/user-data/index';

const datamodel = parsePrismaSchema(`
model User { id String @id }
model Job { id String @id }
model Recipe {
  id String @id
  ownerId String
  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)
}
model Pantry {
  id String @id
  ownerId String
  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)
}
`);

beforeAll(() => {
  registerUserOwnedModels([
    { model: 'Recipe', ownerField: 'ownerId', purge: 'delete', export: 'include', rationale: 'r' },
    { model: 'Pantry', ownerField: 'ownerId', purge: 'delete', export: 'include', rationale: 'p' },
  ]);
  registerUserDataCategory({ id: 'recipes', label: 'Recipes', description: 'd', content: true });
  registerUserDataModels([{ model: 'Recipe', category: 'recipes' }]); // Pantry has NO decision.
});

const make = (model = datamodel) => {
  const registry = new DoctorCheckRegistry();
  const check = new UserDataRegistriesDoctorCheck(registry, resolveUserDataModuleOptions({ datamodel: model }));
  check.onModuleInit();
  return { check, registry };
};

describe('UserDataRegistriesDoctorCheck', () => {
  it('registers itself as user-data.registries', () => {
    const { check, registry } = make();
    expect(registry.get('user-data.registries')).toBe(check);
    expect(check.category).toBe('user-data');
  });

  it('fails, naming the model, when an owner model has no keep-or-delete decision', async () => {
    const outcome = await make().check.run();

    expect(outcome.status).toBe('fail');
    expect(outcome.detail).toMatch(/Pantry \(owner ownerId\) has no user-data decision/);
    expect(outcome.remedy).toMatch(/registerUserDataModels/);
    expect((outcome.data as { findings: number }).findings).toBeGreaterThanOrEqual(1);
  });

  it('passes once the model is decided', async () => {
    registerUserDataModels([{ model: 'Pantry', keep: 'Shared with the household; survives a deletion.' }]);
    const outcome = await make().check.run();

    expect(outcome).toMatchObject({ status: 'pass' });
    expect(outcome.data).toMatchObject({ ownerModels: expect.any(Number), categories: expect.any(Number) });
  });

  it('fails with the error, never throws, when the schema cannot be read', async () => {
    const registry = new DoctorCheckRegistry();
    const check = new UserDataRegistriesDoctorCheck(
      registry,
      resolveUserDataModuleOptions({
        datamodel: () => {
          throw new Error('cannot find prisma/schema');
        },
      }),
    );

    await expect(check.run()).resolves.toMatchObject({ status: 'fail', error: 'cannot find prisma/schema' });
  });
});
