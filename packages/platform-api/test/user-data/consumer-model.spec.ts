// Modularity of the resets (issue #880): a consumer app that adds ONE new
// user-owned model to its manifest gets it purged by the per-user deletion,
// deleted by the admin factory reset and written to the user's data export,
// with no edit to the user-data or exports slices. The registrations below are
// exactly what an app's manifest holds: the ownership entry (core's registry)
// and a category plus a model hint (this slice's).

import { registerUserOwnedModels } from '../../src/core/index';
import { userDataTables, type ExportContext, type ExportDatamodel, type ExportTable } from '../../src/exports/index';
import { JobHandlerRegistry } from '../../src/jobs/index';
import { parsePrismaSchema } from '../../src/testing/index';
import {
  FactoryResetHandler,
  UserDataPlanService,
  UserPurgeRunner,
  findUserDataScope,
  registerPlatformUserData,
  registerUserDataCategory,
  registerUserDataModels,
  resolveUserDataModuleOptions,
  categoriesOfScope,
} from '../../src/user-data/index';
import { fakeDb } from '../exports/support';
import { createFakeDb } from './fake-db';

const ME = '00000000-0000-4000-8000-0000000000a1';
const OTHER = '00000000-0000-4000-8000-0000000000b2';
const JOB = '00000000-0000-4000-8000-00000000f001';

// The app's schema: the platform's `User` and `Job`, plus the consumer's NEW
// model, `Recipe`, owned by a user.
const datamodel = parsePrismaSchema(`
model User { id String @id }
model Job { id String @id }
model Recipe {
  id String @id
  ownerId String
  title String
  owner User @relation(fields: [ownerId], references: [id], onDelete: Cascade)
}
`);

const exportDatamodel: ExportDatamodel = {
  models: [
    { name: 'User', fields: [{ name: 'id', kind: 'scalar', type: 'String', isId: true }] },
    {
      name: 'Recipe',
      fields: [
        { name: 'id', kind: 'scalar', type: 'String', isId: true },
        { name: 'ownerId', kind: 'scalar', type: 'String' },
        { name: 'title', kind: 'scalar', type: 'String' },
      ],
    },
  ],
};

// ---- the consumer's manifest: the ONLY thing that names Recipe -----------------
beforeAll(() => {
  registerPlatformUserData();
  registerUserOwnedModels([
    { model: 'Recipe', ownerField: 'ownerId', purge: 'delete', export: 'include', rationale: 'A user\'s own recipes.' },
  ]);
  registerUserDataCategory({ id: 'recipes', label: 'Recipes', description: 'Your recipes.', content: true });
  registerUserDataModels([{ model: 'Recipe', category: 'recipes' }]);
});

const seed = () => ({
  user: [{ id: ME }, { id: OTHER }],
  recipe: [
    { id: 'r1', ownerId: ME, title: 'Soup' },
    { id: 'r2', ownerId: ME, title: 'Bread' },
    { id: 'r3', ownerId: OTHER, title: 'Theirs' },
  ],
  job: [{ id: JOB, status: 'running', payload: {} }],
});

function build(fake: ReturnType<typeof createFakeDb>) {
  const options = resolveUserDataModuleOptions({ datamodel });
  const plans = new UserDataPlanService(options);
  const storage = { delete: jest.fn(), abortMultipartUpload: jest.fn() };
  const audit = { record: jest.fn(async () => undefined) };
  const runner = new UserPurgeRunner(fake as never, storage as never, plans, { enqueue: jest.fn() } as never, audit, options);
  return { plans, runner, factory: new FactoryResetHandler(new JobHandlerRegistry(), fake as never, storage as never, plans, runner, audit, options) };
}

describe('a consumer registers a new user-owned model (#880)', () => {
  it('the plan, the scopes and the Danger Zone categories pick it up', () => {
    const { plans } = build(createFakeDb(seed()));

    expect(plans.user().steps.map((step) => step.model)).toContain('Recipe');
    // The platform's own "content" scope covers every content category, the new one included.
    expect(categoriesOfScope(findUserDataScope('content')!)).toContain('recipes');
    expect(categoriesOfScope(findUserDataScope('everything')!)).toContain('recipes');
  });

  it('the per-user deletion removes the user\'s recipes and no one else\'s', async () => {
    const fake = createFakeDb(seed());
    const { runner } = build(fake);

    const result = await runner.runJob(fake.tables.job![0] as never, { userId: ME, scope: 'content' });

    expect(fake.tables.recipe!.map((row) => row.id)).toEqual(['r3']);
    expect(result.categories).toMatchObject({ recipes: 2 });
  });

  it('the admin factory reset deletes every user\'s recipes', async () => {
    const fake = createFakeDb({ ...seed(), job: [{ id: JOB, status: 'running', payload: { actorUserId: ME } }] });
    const { factory } = build(fake);

    await factory.process(fake.tables.job![0] as never);

    expect(fake.tables.recipe).toEqual([]);
    expect(fake.tables.user!.map((row) => row.id)).toEqual([ME]);
  });

  it('the user-data export writes the user\'s recipes as their own dataset', async () => {
    const out: Record<string, Array<Record<string, unknown>>> = {};
    const context: ExportContext = {
      exportId: JOB,
      scope: 'user',
      subjectId: ME,
      requestedById: ME,
      db: fakeDb(structuredClone(seed()), []),
      datamodel: exportDatamodel,
      pageSize: 10,
      now: new Date('2026-01-01T00:00:00.000Z'),
    };
    for await (const table of userDataTables(context) as AsyncIterable<ExportTable>) {
      out[table.dataset] = [];
      for await (const row of table.rows) out[table.dataset]!.push({ ...row });
    }

    expect(out.recipe!.map((row) => row.title)).toEqual(['Soup', 'Bread']);
  });
});
